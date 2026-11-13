import type { WiserClient } from './wiser-client';
import type { WiserDomain } from './wiser-types';

export type HubListener = (domain: WiserDomain) => void | Promise<void>;

export interface WiserHubOptions {
  client: WiserClient;
  intervalMs?: number;
}

export class WiserHub {
  private client: WiserClient;
  private intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly listeners: Map<string, HubListener> = new Map();
  private latestDomain: WiserDomain | null = null;
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
      Promise.resolve(listener(this.latestDomain)).catch(() => {});
    }
  }

  unregister(id: string): void {
    this.listeners.delete(id);
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
      for (const listener of this.listeners.values()) {
        if (generation !== this.generation) return null;
        await Promise.resolve(listener(domain));
      }
      return domain;
    } finally {
      this.polling = false;
      if (this.pendingPoll) {
        this.pendingPoll = false;
        this.poll().catch(() => {});
      }
    }
  }
}
