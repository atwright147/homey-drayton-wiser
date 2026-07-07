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

  constructor(opts: WiserClientOptions) {
    this.host = opts.host;
    this.secret = opts.secret;
    this.useHttps = opts.useHttps ?? false;
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

  private buildInit(protocol: 'http' | 'https', method: string, body: unknown): RequestInit {
    const init: RequestInit = {
      method,
      headers: this.headers(),
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }
    if (protocol === 'https') {
      init.dispatcher = this.httpsAgent;
    }
    return init;
  }

  private async attemptFetch(protocol: 'http' | 'https', path: string, method: string, body: unknown): Promise<Response> {
    const url = this.buildUrl(protocol, path);
    const init = this.buildInit(protocol, method, body);
    let res: Response;
    try {
      res = await this.fetchWithTimeout(url, init);
    } catch (err) {
      if (err instanceof WiserConnectionError) throw err;
      throw new WiserConnectionError(`Network error contacting Wiser hub: ${(err as Error).message}`);
    }
    if (res.status === 401 || res.status === 403) {
      throw new WiserAuthError(`Authentication failed (${res.status}). Check the Wiser hub secret.`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new WiserRestError(res.status, text);
    }
    return res;
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const fetchPromise = this.fetchFn(url, init);
    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        reject(new WiserConnectionError(`Request to Wiser hub timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      timer.unref?.();
    });
    return Promise.race([fetchPromise, timeoutPromise]);
  }

  private async requestWithRetry(protocol: 'http' | 'https', path: string, method: string, body: unknown): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt < this.retries; attempt++) {
      try {
        return await this.attemptFetch(protocol, path, method, body);
      } catch (err) {
        lastError = err;
        const retryable = err instanceof WiserConnectionError || (err instanceof WiserRestError && err.retryable);
        if (!retryable) throw err;
        if (attempt < this.retries - 1) await this.delay();
      }
    }
    throw lastError;
  }

  private async request(path: string, opts: { method?: string; body?: unknown; allowProtocolFallback?: boolean } = {}): Promise<Response> {
    const method = opts.method ?? 'GET';
    const allowFallback = opts.allowProtocolFallback ?? true;
    const primaryProtocol: 'http' | 'https' = this.useHttps ? 'https' : 'http';
    try {
      const res = await this.requestWithRetry(primaryProtocol, path, method, opts.body);
      return res;
    } catch (err) {
      if (allowFallback && !this.useHttps && err instanceof WiserConnectionError) {
        const fallbackRes = await this.requestWithRetry('https', path, method, opts.body);
        return fallbackRes;
      }
      throw err;
    }
  }

  async getDomain(): Promise<WiserDomain> {
    const res = await this.request('/data/v2/domain/');
    return (await res.json()) as WiserDomain;
  }

  async getNetwork(): Promise<WiserNetwork> {
    const res = await this.request('/data/v2/network/');
    return (await res.json()) as WiserNetwork;
  }

  async getSchedules(): Promise<WiserSchedule[]> {
    try {
      const res = await this.request('/data/v2/schedules/');
      const body = (await res.json()) as Record<string, unknown>;
      return flattenScheduleResponse(body);
    } catch (err) {
      if (err instanceof WiserRestError && err.status === 404) return [];
      throw err;
    }
  }

  async getOpentherm(): Promise<unknown> {
    try {
      const res = await this.request('/data/v2/opentherm/');
      return await res.json();
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
      body: { RequestOverride: { Type: 'Manual', SetPoint: toApiTemp(celsius) } },
    });
  }

  async setRoomMode(id: number, mode: RoomMode): Promise<void> {
    await this.request(`/data/v2/domain/Room/${id}`, {
      method: 'PATCH',
      body: { Mode: roomModeToWiser(mode) },
    });
  }

  async boostRoom(id: number, deltaCelsius: number, minutes: number): Promise<void> {
    await this.request(`/data/v2/domain/Room/${id}`, {
      method: 'PATCH',
      body: { RequestOverride: { Type: 'Boost', IncreaseSetPointBy: toApiBoostDelta(deltaCelsius), DurationMinutes: minutes } },
    });
  }

  async setRoomSetpointForDuration(id: number, celsius: number, minutes: number): Promise<void> {
    await this.request(`/data/v2/domain/Room/${id}`, {
      method: 'PATCH',
      body: { RequestOverride: { Type: 'Manual', SetPoint: toApiTemp(celsius), DurationMinutes: minutes } },
    });
  }

  async cancelRoomOverride(id: number): Promise<void> {
    await this.request(`/data/v2/domain/Room/${id}`, {
      method: 'PATCH',
      body: { RequestOverride: { Type: 'None' } },
    });
  }

  async setAwayMode(enabled: boolean): Promise<void> {
    await this.request('/data/v2/domain/System', {
      method: 'PATCH',
      body: { AwayMode: enabled },
    });
  }

  async setComfortMode(enabled: boolean): Promise<void> {
    await this.request('/data/v2/domain/System', {
      method: 'PATCH',
      body: { ComfortModeEnabled: enabled },
    });
  }

  async setEcoMode(enabled: boolean): Promise<void> {
    await this.request('/data/v2/domain/System', {
      method: 'PATCH',
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
      body: { Mode: hotWaterModeToWiser(mode) },
    });
  }

  async setHotWaterOverride(id: number, minutes: number): Promise<void> {
    await this.request(`/data/v2/domain/HotWater/${id}`, {
      method: 'PATCH',
      body: { RequestOverride: { Type: 'Manual', SetPoint: HW_TEMP_ON, DurationMinutes: minutes } },
    });
  }

  async cancelHotWaterOverride(id: number): Promise<void> {
    await this.request(`/data/v2/domain/HotWater/${id}`, {
      method: 'PATCH',
      body: { RequestOverride: { Type: 'None' } },
    });
  }
}
