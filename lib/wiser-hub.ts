import type { WiserClient } from './wiser-client';
import type { WiserDomain } from './wiser-types';
import { WiserAuthError } from './wiser-errors';

export type HubListener = (domain: WiserDomain) => void | Promise<void>;
export type HubUnavailableReason = 'not_ready' | 'connection' | 'authentication';

export interface HubHealthStatus {
  available: boolean;
  reason: HubUnavailableReason | null;
  lastSuccessAt: number | null;
}

export type HubHealthListener = (health: HubHealthStatus) => void | Promise<void>;

export interface WiserHubOptions {
  client: WiserClient;
  intervalMs?: number;
}

export class WiserHub {
  private client: WiserClient;
  private intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly listeners: Map<string, HubListener> = new Map();
  private readonly healthListeners: Map<string, HubHealthListener> = new Map();
  private latestDomain: WiserDomain | null = null;
  private health: HubHealthStatus = { available: false, reason: 'not_ready', lastSuccessAt: null };
  private consecutiveFailures = 0;
  private running = false;
  private polling = false;
  private pendingPoll = false;
  private generation = 0;

  constructor(opts: WiserHubOptions) {
    this.client = opts.client;
    this.intervalMs = opts.intervalMs ?? 30000;
  }

  register(id: string, listener: HubListener): void {
    this.listeners.set(id, listener);
    if (this.latestDomain !== null) {
      const domain = this.latestDomain;
      Promise.resolve().then(() => {
        if (this.listeners.get(id) !== listener || this.latestDomain !== domain) return undefined;
        return listener(domain);
      }).catch(() => {});
    }
  }

  unregister(id: string): void {
    this.listeners.delete(id);
  }

  registerHealth(id: string, listener: HubHealthListener): void {
    this.healthListeners.set(id, listener);
    const health = this.getHealth();
    Promise.resolve().then(() => {
      if (this.healthListeners.get(id) !== listener) return undefined;
      return listener(health);
    }).catch(() => {});
  }

  unregisterHealth(id: string): void {
    this.healthListeners.delete(id);
  }

  getHealth(): HubHealthStatus {
    return { ...this.health };
  }

  private async notifyHealth(health: HubHealthStatus): Promise<void> {
    for (const listener of this.healthListeners.values()) {
      if (this.health !== health) return;
      try {
        await Promise.resolve(listener({ ...health }));
      } catch {
        continue;
      }
    }
  }

  private setHealth(available: boolean, reason: HubUnavailableReason | null, lastSuccessAt: number | null): Promise<void> {
    const changed = this.health.available !== available || this.health.reason !== reason;
    this.health = { available, reason, lastSuccessAt };
    if (!changed) return Promise.resolve();
    return this.notifyHealth(this.health);
  }

  getDomain(): WiserDomain | null {
    return this.latestDomain;
  }

  getClient(): WiserClient {
    return this.client;
  }

  setClient(client: WiserClient): void {
    if (this.client === client) return;
    const previous = this.client;
    this.client = client;
    this.latestDomain = null;
    this.consecutiveFailures = 0;
    this.setHealth(false, 'not_ready', null).catch(() => {});
    this.generation += 1;
    previous.abortPendingRequests?.();
    previous.dispose?.().catch(() => {});
    if (this.polling) {
      this.pendingPoll = true;
    } else if (this.running) {
      this.poll().catch(() => {});
    }
  }

  setInterval(ms: number): void {
    this.intervalMs = ms;
    if (this.running) {
      if (this.timer !== null) clearInterval(this.timer);
      this.timer = setInterval(() => {
        this.poll().catch(() => {});
      }, this.intervalMs);
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.poll().catch(() => {});
    this.timer = setInterval(() => {
      this.poll().catch(() => {});
    }, this.intervalMs);
  }

  stop(): void {
    this.running = false;
    this.generation += 1;
    this.pendingPoll = false;
    this.latestDomain = null;
    this.consecutiveFailures = 0;
    this.setHealth(false, 'not_ready', this.health.lastSuccessAt).catch(() => {});
    this.client.abortPendingRequests?.();
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  dispose(): void {
    this.stop();
    this.client.dispose?.().catch(() => {});
  }

  isRunning(): boolean {
    return this.running;
  }

  async poll(): Promise<WiserDomain | null> {
    if (this.polling) {
      this.pendingPoll = true;
      return null;
    }
    this.polling = true;
    const { generation, client } = this;
    try {
      const [domain, schedules] = await Promise.all([
        client.getDomain(),
        client.getSchedules().catch(() => []),
      ]);
      if (generation !== this.generation) return null;
      if (schedules.length > 0) {
        domain.Schedule = schedules;
      }
      this.latestDomain = domain;
      this.consecutiveFailures = 0;
      for (const listener of this.listeners.values()) {
        if (generation !== this.generation) return null;
        try {
          await Promise.resolve(listener(domain));
        } catch {
          continue;
        }
      }
      if (generation !== this.generation) return null;
      await this.setHealth(true, null, Date.now());
      return domain;
    } catch (err) {
      if (generation === this.generation) {
        this.consecutiveFailures += 1;
        const reason = err instanceof WiserAuthError ? 'authentication' : 'connection';
        const { lastSuccessAt } = this.health;
        const stale = lastSuccessAt !== null && Date.now() - lastSuccessAt >= this.intervalMs * 2;
        if (lastSuccessAt === null || reason === 'authentication' || this.consecutiveFailures >= 3 || stale) {
          this.latestDomain = null;
          await this.setHealth(false, reason, lastSuccessAt);
        }
      }
      throw err;
    } finally {
      this.polling = false;
      if (this.pendingPoll) {
        this.pendingPoll = false;
        this.poll().catch(() => {});
      }
    }
  }
}
