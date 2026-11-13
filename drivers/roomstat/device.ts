import Homey from 'homey';
import WiserHubManager from '../../lib/wiser-hub-manager';
import { WiserHub, type HubHealthStatus, type HubUnavailableReason } from '../../lib/wiser-hub';
import { getRoomStatReadings } from '../../lib/wiser-roomstat';
import type { WiserDomain } from '../../lib/wiser-types';

interface HubApp extends Homey.App {
  hubManager: WiserHubManager;
}

type Availability = HubUnavailableReason | 'available' | 'missing' | 'offline';

class RoomStatDevice extends Homey.Device {
  private active = false;
  private availabilityTarget: Availability | 'unknown' = 'unknown';
  private availabilityTask: Promise<void> = Promise.resolve();

  private getManager(): WiserHubManager {
    return (this.homey.app as HubApp).hubManager;
  }

  private getHubId(): string {
    return this.getStoreValue('hubId') as string;
  }

  private getRoomStatId(): number {
    return this.getStoreValue('roomStatId') as number;
  }

  private getListenerId(): string {
    return `roomstat:${this.getData().id as string}`;
  }

  async onInit(): Promise<void> {
    this.active = true;
    const manager = this.getManager();
    const hubId = this.getHubId();
    manager.subscribe(hubId, this.getListenerId(), (domain) => this.onPoll(domain, manager.get(hubId)));
    manager.subscribeHealth(hubId, this.getListenerId(), (health) => this.onHealth(health));
    const hub = manager.get(hubId);
    if (!hub) {
      await this.updateAvailability('not_ready');
    } else if (!hub.getDomain()) {
      try {
        await hub.poll();
      } catch {
        this.error('Initial RoomStat poll failed.');
      }
    }
  }

  private updateAvailability(target: Availability): Promise<void> {
    if (this.availabilityTarget === target) return this.availabilityTask;
    this.availabilityTarget = target;
    this.availabilityTask = this.availabilityTask.then(async () => {
      if (!this.active || this.availabilityTarget !== target) return;
      if (target === 'available') {
        await this.setAvailable();
        return;
      }
      const messages = {
        not_ready: 'The parent Wiser HeatHub is not available.',
        authentication: 'Wiser HeatHub authentication failed. Check the secret.',
        connection: 'Could not connect to the Wiser HeatHub.',
        missing: 'This RoomStat is no longer reported by the Wiser HeatHub.',
        offline: 'The Wiser HeatHub reports this RoomStat as offline.',
      };
      await this.setUnavailable(messages[target]);
    }).catch((err) => {
      this.error('Could not update RoomStat availability:', err);
      if (this.availabilityTarget === target) this.availabilityTarget = 'unknown';
    });
    return this.availabilityTask;
  }

  private async onHealth(health: HubHealthStatus): Promise<void> {
    if (!this.active || health.available || !health.reason) return;
    const hub = this.getManager().get(this.getHubId());
    if (hub?.getDomain()) return;
    const current = hub?.getHealth();
    if (current && (current.available !== health.available || current.reason !== health.reason)) return;
    await this.updateAvailability(health.reason);
  }

  private hasCurrentDomain(domain: WiserDomain, sourceHub: WiserHub | undefined): boolean {
    return this.active && !!sourceHub && this.getManager().get(this.getHubId()) === sourceHub
      && sourceHub.getDomain() === domain;
  }

  private async onPoll(domain: WiserDomain, sourceHub: WiserHub | undefined): Promise<void> {
    if (!this.hasCurrentDomain(domain, sourceHub)) return;
    const stat = getRoomStatReadings(domain, this.getRoomStatId());
    const readings = {
      measure_temperature: stat?.offline ? null : stat?.temperature ?? null,
      measure_humidity: stat?.offline ? null : stat?.humidity ?? null,
      measure_battery: stat?.battery ?? null,
      measure_signal: stat?.signal ?? null,
    };
    for (const [capability, value] of Object.entries(readings)) {
      if (!this.hasCurrentDomain(domain, sourceHub)) return;
      await this.setCapabilityValue(capability, value).catch(this.error);
    }
    if (!this.hasCurrentDomain(domain, sourceHub)) return;
    let target: Availability = 'available';
    if (!stat) target = 'missing';
    else if (stat.offline) target = 'offline';
    await this.updateAvailability(target);
    if (!this.hasCurrentDomain(domain, sourceHub)) {
      await this.onHealth(this.getManager().get(this.getHubId())?.getHealth()
        ?? { available: false, reason: 'not_ready', lastSuccessAt: null });
    }
  }

  private teardown(): void {
    this.active = false;
    this.getManager().unsubscribe(this.getHubId(), this.getListenerId());
    this.getManager().unsubscribeHealth(this.getHubId(), this.getListenerId());
  }

  async onUninit(): Promise<void> {
    this.teardown();
  }

  async onDeleted(): Promise<void> {
    this.teardown();
  }
}

module.exports = RoomStatDevice;
