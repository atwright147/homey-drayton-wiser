import type { WiserClient } from './wiser-client';
import type { WiserDomain } from './wiser-types';

export type HubListener = (domain: WiserDomain) => void | Promise<void>;

export interface WiserHubOptions {
  client: WiserClient;
  intervalMs?: number;
}

export class WiserHub {
  private readonly client: WiserClient;
  private intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly listeners: Map<string, HubListener> = new Map();
  private latestDomain: WiserDomain | null = null;
  private running = false;
  private polling = false;
  private pendingPoll = false;

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

  setInterval(ms: number): void {
    this.intervalMs = ms;
    if (this.running) {
      this.stop();
      this.start();
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
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
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
    try {
      const domain = await this.client.getDomain();
      this.latestDomain = domain;
      for (const listener of this.listeners.values()) {
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
