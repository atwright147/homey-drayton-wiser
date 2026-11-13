import { WiserHub, type HubHealthListener, type HubListener } from './wiser-hub';

export default class WiserHubManager {
  private readonly hubs: Map<string, WiserHub> = new Map();
  private readonly subscribers: Map<string, Map<string, HubListener>> = new Map();
  private readonly healthSubscribers: Map<string, Map<string, HubHealthListener>> = new Map();

  register(hubDeviceId: string, hub: WiserHub): void {
    const previous = this.hubs.get(hubDeviceId);
    if (previous === hub) return;
    previous?.dispose();
    this.hubs.set(hubDeviceId, hub);
    for (const [listenerId, listener] of this.subscribers.get(hubDeviceId) ?? []) {
      hub.register(listenerId, listener);
    }
    for (const [listenerId, listener] of this.healthSubscribers.get(hubDeviceId) ?? []) {
      hub.registerHealth(listenerId, listener);
    }
  }

  unregister(hubDeviceId: string, expectedHub?: WiserHub): void {
    const hub = this.hubs.get(hubDeviceId);
    if (hub && (!expectedHub || hub === expectedHub)) {
      hub.dispose();
      this.hubs.delete(hubDeviceId);
    }
  }

  subscribe(hubDeviceId: string, listenerId: string, listener: HubListener): void {
    let listeners = this.subscribers.get(hubDeviceId);
    if (!listeners) {
      listeners = new Map();
      this.subscribers.set(hubDeviceId, listeners);
    }
    listeners.set(listenerId, listener);
    this.hubs.get(hubDeviceId)?.register(listenerId, listener);
  }

  unsubscribe(hubDeviceId: string, listenerId: string): void {
    const listeners = this.subscribers.get(hubDeviceId);
    listeners?.delete(listenerId);
    if (listeners?.size === 0) this.subscribers.delete(hubDeviceId);
    this.hubs.get(hubDeviceId)?.unregister(listenerId);
  }

  subscribeHealth(hubDeviceId: string, listenerId: string, listener: HubHealthListener): void {
    let listeners = this.healthSubscribers.get(hubDeviceId);
    if (!listeners) {
      listeners = new Map();
      this.healthSubscribers.set(hubDeviceId, listeners);
    }
    listeners.set(listenerId, listener);
    const hub = this.hubs.get(hubDeviceId);
    if (hub) {
      hub.registerHealth(listenerId, listener);
    } else {
      Promise.resolve().then(() => {
        if (this.healthSubscribers.get(hubDeviceId)?.get(listenerId) !== listener) return undefined;
        return listener({ available: false, reason: 'not_ready', lastSuccessAt: null });
      }).catch(() => {});
    }
  }

  unsubscribeHealth(hubDeviceId: string, listenerId: string): void {
    const listeners = this.healthSubscribers.get(hubDeviceId);
    listeners?.delete(listenerId);
    if (listeners?.size === 0) this.healthSubscribers.delete(hubDeviceId);
    this.hubs.get(hubDeviceId)?.unregisterHealth(listenerId);
  }

  get(hubDeviceId: string): WiserHub | undefined {
    return this.hubs.get(hubDeviceId);
  }

  has(hubDeviceId: string): boolean {
    return this.hubs.has(hubDeviceId);
  }
}
