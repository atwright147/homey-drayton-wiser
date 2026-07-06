import { WiserHub } from './wiser-hub';

export default class WiserHubManager {
  private readonly hubs: Map<string, WiserHub> = new Map();

  register(hubDeviceId: string, hub: WiserHub): void {
    this.hubs.set(hubDeviceId, hub);
  }

  unregister(hubDeviceId: string): void {
    const hub = this.hubs.get(hubDeviceId);
    if (hub) {
      hub.stop();
      this.hubs.delete(hubDeviceId);
    }
  }

  get(hubDeviceId: string): WiserHub | undefined {
    return this.hubs.get(hubDeviceId);
  }

  has(hubDeviceId: string): boolean {
    return this.hubs.has(hubDeviceId);
  }
}
