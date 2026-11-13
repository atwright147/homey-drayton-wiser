import { fetch as undiciFetch, Agent } from 'undici';
import type { Dispatcher, Response, RequestInit } from 'undici';
import type { WiserDomain, WiserNetwork, WiserSchedule } from './wiser-types';
import { flattenScheduleResponse } from './wiser-utils';
import { WiserAuthError, WiserConnectionError, WiserRestError } from './wiser-errors';
import {
  toApiTemp,
  toApiBoostDelta,
  HW_TEMP_ON,
  roomModeToWiser,
  hotWaterModeToWiser,
  type RoomMode,
  type HotWaterMode,
} from './wiser-utils';

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export interface WiserClientOptions {
  host: string;
  secret: string;
  useHttps?: boolean;
  retries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  fetchFn?: FetchFn;
}

export class WiserClient {
  private readonly host: string;
  private readonly secret: string;
  private readonly useHttps: boolean;
  private readonly retries: number;
  private readonly retryDelayMs: number;
  private readonly timeoutMs: number;
  private readonly fetchFn: FetchFn;
  private readonly httpsAgent: Dispatcher;
  private preferredProtocol: 'http' | 'https';
  private readonly activeRequests = new Set<AbortController>();
  private cancellationEpoch = 0;
  private disposed = false;

  constructor(opts: WiserClientOptions) {
    this.host = opts.host;
    this.secret = opts.secret;
    this.useHttps = opts.useHttps ?? false;
    this.preferredProtocol = this.useHttps ? 'https' : 'http';
    this.retries = opts.retries ?? 3;
    this.retryDelayMs = opts.retryDelayMs ?? 100;
    this.timeoutMs = opts.timeoutMs ?? 10000;
    this.fetchFn = opts.fetchFn ?? undiciFetch;
    this.httpsAgent = new Agent({ connect: { rejectUnauthorized: false } });
  }

  private headers(): Record<string, string> {
    return {
      SECRET: this.secret,
      'Content-Type': 'application/json',
    };
  }

  private async delay(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, this.retryDelayMs));
  }

  private buildUrl(protocol: 'http' | 'https', path: string): string {
    return `${protocol}://${this.host}${path}`;
  }

  private buildInit(protocol: 'http' | 'https', method: string, body: unknown, signal: AbortSignal): RequestInit {
    const init: RequestInit = {
      method,
      headers: this.headers(),
      signal,
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }
    if (protocol === 'https') {
      init.dispatcher = this.httpsAgent;
    }
    return init;
  }

  private async withAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) throw signal.reason;
    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => {
        signal.removeEventListener('abort', onAbort);
        reject(signal.reason);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      operation.then(
        (value) => {
          signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        (error) => {
          signal.removeEventListener('abort', onAbort);
          reject(error);
        },
      );
    });
  }

  private async attemptFetch<T>(
    protocol: 'http' | 'https',
    path: string,
    method: string,
    body: unknown,
    responseType: 'json' | 'discard',
  ): Promise<T> {
    const url = this.buildUrl(protocol, path);
    const controller = new AbortController();
    const init = this.buildInit(protocol, method, body, controller.signal);
    const timeoutError = new WiserConnectionError(`Request to Wiser hub timed out after ${this.timeoutMs}ms`);
    const timer = setTimeout(() => controller.abort(timeoutError), this.timeoutMs);
    timer.unref?.();
    this.activeRequests.add(controller);
    let res: Response | null = null;
    try {
      res = await this.withAbort(this.fetchFn(url, init), controller.signal);
      if (res.status === 401 || res.status === 403) {
        await this.withAbort(res.arrayBuffer(), controller.signal);
        throw new WiserAuthError(`Authentication failed (${res.status}). Check the Wiser hub secret.`);
      }
      if (!res.ok) {
        const text = await this.withAbort(res.text(), controller.signal);
        throw new WiserRestError(res.status, text);
      }
      if (responseType === 'discard') {
        await this.withAbort(res.arrayBuffer(), controller.signal);
        return undefined as T;
      }
      return await this.withAbort(res.json(), controller.signal) as T;
    } catch (err) {
      if (err instanceof WiserAuthError || err instanceof WiserRestError) throw err;
      if (controller.signal.aborted) {
        throw controller.signal.reason instanceof Error ? controller.signal.reason : timeoutError;
      }
      if (err instanceof WiserConnectionError) throw err;
      throw new WiserConnectionError(`Network error contacting Wiser hub: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
      this.activeRequests.delete(controller);
      if (res && !res.bodyUsed) {
        res.body?.cancel().catch(() => {});
      }
    }
  }

  abortPendingRequests(): void {
    this.cancellationEpoch += 1;
    for (const controller of this.activeRequests) {
      controller.abort(new WiserConnectionError('Wiser hub request cancelled'));
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.abortPendingRequests();
    await this.httpsAgent.destroy();
  }

  private async requestWithRetry<T>(
    protocol: 'http' | 'https',
    path: string,
    method: string,
    body: unknown,
    responseType: 'json' | 'discard',
    cancellationEpoch: number,
    maxAttempts: number,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (this.disposed || cancellationEpoch !== this.cancellationEpoch) {
        throw lastError ?? new WiserConnectionError('Wiser hub request cancelled');
      }
      try {
        return await this.attemptFetch<T>(protocol, path, method, body, responseType);
      } catch (err) {
        lastError = err;
        if (this.disposed || cancellationEpoch !== this.cancellationEpoch) throw err;
        const retryable = err instanceof WiserConnectionError || (err instanceof WiserRestError && err.retryable);
        if (!retryable) throw err;
        if (attempt < maxAttempts - 1) await this.delay();
      }
    }
    throw lastError;
  }

  private async request<T>(
    path: string,
    opts: { method?: string; body?: unknown; allowProtocolFallback?: boolean; responseType?: 'json' | 'discard' } = {},
  ): Promise<T> {
    const method = opts.method ?? 'GET';
    const allowFallback = opts.allowProtocolFallback ?? true;
    const responseType = opts.responseType ?? 'json';
    const primaryProtocol = this.preferredProtocol;
    const maxAttempts = method === 'GET' ? this.retries : 1;
    const { cancellationEpoch } = this;
    try {
      return await this.requestWithRetry<T>(primaryProtocol, path, method, opts.body, responseType, cancellationEpoch, maxAttempts);
    } catch (err) {
      if (allowFallback && method === 'GET' && primaryProtocol === 'http'
        && !this.disposed && cancellationEpoch === this.cancellationEpoch
        && err instanceof WiserConnectionError) {
        const result = await this.requestWithRetry<T>('https', path, method, opts.body, responseType, cancellationEpoch, maxAttempts);
        this.preferredProtocol = 'https';
        return result;
      }
      throw err;
    }
  }

  async getDomain(): Promise<WiserDomain> {
    return this.request<WiserDomain>('/data/v2/domain/');
  }

  async getNetwork(): Promise<WiserNetwork> {
    return this.request<WiserNetwork>('/data/v2/network/');
  }

  async getSchedules(): Promise<WiserSchedule[]> {
    try {
      const body = await this.request<Record<string, unknown>>('/data/v2/schedules/');
      return flattenScheduleResponse(body);
    } catch (err) {
      if (err instanceof WiserRestError && err.status === 404) return [];
      throw err;
    }
  }

  async getOpentherm(): Promise<unknown> {
    try {
      return await this.request<unknown>('/data/v2/opentherm/');
    } catch (err) {
      if (err instanceof WiserRestError && err.status === 404) return null;
      throw err;
    }
  }

  async verifyConnection(): Promise<boolean> {
    try {
      const domain = await this.getDomain();
      return domain.System?.BrandName === 'WiserHeat';
    } catch {
      return false;
    }
  }

  async verifyConnectionWithDomain(): Promise<WiserDomain | null> {
    try {
      const domain = await this.getDomain();
      if (domain.System?.BrandName === 'WiserHeat') return domain;
      return null;
    } catch {
      return null;
    }
  }

  async setRoomSetpoint(id: number, celsius: number): Promise<void> {
    await this.request(`/data/v2/domain/Room/${id}`, {
      method: 'PATCH',
      responseType: 'discard',
      body: { RequestOverride: { Type: 'Manual', SetPoint: toApiTemp(celsius) } },
    });
  }

  async setRoomMode(id: number, mode: RoomMode): Promise<void> {
    await this.request(`/data/v2/domain/Room/${id}`, {
      method: 'PATCH',
      responseType: 'discard',
      body: { Mode: roomModeToWiser(mode) },
    });
  }

  async boostRoom(id: number, deltaCelsius: number, minutes: number): Promise<void> {
    await this.request(`/data/v2/domain/Room/${id}`, {
      method: 'PATCH',
      responseType: 'discard',
      body: { RequestOverride: { Type: 'Boost', IncreaseSetPointBy: toApiBoostDelta(deltaCelsius), DurationMinutes: minutes } },
    });
  }

  async setRoomSetpointForDuration(id: number, celsius: number, minutes: number): Promise<void> {
    await this.request(`/data/v2/domain/Room/${id}`, {
      method: 'PATCH',
      responseType: 'discard',
      body: { RequestOverride: { Type: 'Manual', SetPoint: toApiTemp(celsius), DurationMinutes: minutes } },
    });
  }

  async cancelRoomOverride(id: number): Promise<void> {
    await this.request(`/data/v2/domain/Room/${id}`, {
      method: 'PATCH',
      responseType: 'discard',
      body: { RequestOverride: { Type: 'None' } },
    });
  }

  async setAwayMode(enabled: boolean): Promise<void> {
    await this.request('/data/v2/domain/System', {
      method: 'PATCH',
      responseType: 'discard',
      body: { AwayMode: enabled },
    });
  }

  async setComfortMode(enabled: boolean): Promise<void> {
    await this.request('/data/v2/domain/System', {
      method: 'PATCH',
      responseType: 'discard',
      body: { ComfortModeEnabled: enabled },
    });
  }

  async setEcoMode(enabled: boolean): Promise<void> {
    await this.request('/data/v2/domain/System', {
      method: 'PATCH',
      responseType: 'discard',
      body: { EcoModeEnabled: enabled },
    });
  }

  async boostAllRooms(deltaCelsius: number, minutes: number): Promise<void> {
    const domain = await this.getDomain();
    const rooms = domain.Room ?? [];
    for (const room of rooms) {
      await this.boostRoom(room.id, deltaCelsius, minutes);
    }
  }

  async setHotWaterMode(id: number, mode: HotWaterMode): Promise<void> {
    await this.request(`/data/v2/domain/HotWater/${id}`, {
      method: 'PATCH',
      responseType: 'discard',
      body: { Mode: hotWaterModeToWiser(mode) },
    });
  }

  async setHotWaterOverride(id: number, minutes: number): Promise<void> {
    await this.request(`/data/v2/domain/HotWater/${id}`, {
      method: 'PATCH',
      responseType: 'discard',
      body: { RequestOverride: { Type: 'Manual', SetPoint: HW_TEMP_ON, DurationMinutes: minutes } },
    });
  }

  async cancelHotWaterOverride(id: number): Promise<void> {
    await this.request(`/data/v2/domain/HotWater/${id}`, {
      method: 'PATCH',
      responseType: 'discard',
      body: { RequestOverride: { Type: 'None' } },
    });
  }
}
