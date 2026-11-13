import Homey from 'homey';
import WiserHubManager from '../../lib/wiser-hub-manager';
import { WiserHub, type HubHealthStatus, type HubUnavailableReason } from '../../lib/wiser-hub';
import {
  roomModeFromWiser,
  validTemperatureFromApi,
  type RoomMode,
} from '../../lib/wiser-utils';
import type { WiserDomain, WiserRoom } from '../../lib/wiser-types';

interface HubApp extends Homey.App {
  hubManager: WiserHubManager;
}

const MIN_TARGET_TEMP = 5;
const ROOM_MODE_CAPABILITY = 'wiser_room_mode';

function roomTemperature(room: WiserRoom): number | null {
  return validTemperatureFromApi(room.CalculatedTemperature);
}

function targetTemperature(room: WiserRoom): number | null {
  return validTemperatureFromApi(room.CurrentSetPoint ?? room.ScheduledSetPoint);
}

function roomHumidity(domain: WiserDomain, room: WiserRoom): number | null {
  const roomStatId = room.RoomStatId;
  if (roomStatId == null) {
    return null;
  }
  const roomStat = domain.RoomStat?.find((rs) => rs.id === roomStatId);
  if (roomStat?.MeasuredHumidity == null) {
    return null;
  }
  return roomStat.MeasuredHumidity;
}

class RoomDevice extends Homey.Device {
  private active = false;
  private availabilityTarget: HubUnavailableReason | 'available' | 'unknown' = 'unknown';
  private availabilityTask: Promise<void> = Promise.resolve();

  async onInit(): Promise<void> {
    this.log('Wiser Room device init:', this.getName());
    await this.setCapabilityValue(ROOM_MODE_CAPABILITY, 'auto').catch(this.error);
    await this.setupRoom();
  }

  private getManager(): WiserHubManager {
    return (this.homey.app as HubApp).hubManager;
  }

  private getRoomId(): number {
    return this.getStoreValue('roomId') as number;
  }

  private getHubId(): string {
    return this.getStoreValue('hubId') as string;
  }

  private async setupRoom(): Promise<void> {
    const hubId = this.getHubId();
    const roomId = this.getRoomId();
    const manager = this.getManager();
    this.active = true;
    manager.subscribe(hubId, `room:${roomId}`, (domain) => this.onPoll(domain, manager.get(hubId)));
    manager.subscribeHealth(hubId, `room:${roomId}`, (health) => this.onHealth(health));

    this.registerCapabilityListener('target_temperature', async (value: number) => {
      const currentHub = this.getManager().get(hubId);
      if (!currentHub) throw new Error('Hub not available');
      await currentHub.getClient().setRoomSetpoint(roomId, value);
      await currentHub.poll();
    });

    this.registerCapabilityListener(ROOM_MODE_CAPABILITY, async (value: string) => {
      const currentHub = this.getManager().get(hubId);
      if (!currentHub) throw new Error('Hub not available');
      await currentHub.getClient().setRoomMode(roomId, value as RoomMode);
      await currentHub.poll();
    });

    const hub = manager.get(hubId);
    if (!hub) {
      await this.onHealth({ available: false, reason: 'not_ready', lastSuccessAt: null });
    } else {
      try {
        await hub.poll();
      } catch (err) {
        this.error('Initial room poll failed:', err);
      }
    }
  }

  private updateAvailability(target: HubUnavailableReason | 'available'): Promise<void> {
    if (this.availabilityTarget === target) return this.availabilityTask;
    this.availabilityTarget = target;
    this.availabilityTask = this.availabilityTask.then(async () => {
      if (this.availabilityTarget !== target || !this.active) return;
      if (target === 'available') {
        await this.setAvailable();
        return;
      }
      let message = 'The parent Wiser HeatHub is not available.';
      if (target === 'authentication') message = 'Wiser HeatHub authentication failed. Check the secret.';
      if (target === 'connection') message = 'Could not connect to the Wiser HeatHub.';
      await this.setUnavailable(message);
    }).catch((err) => {
      this.error('Could not update room availability:', err);
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
    const roomId = this.getRoomId();
    const room = domain.Room?.find((r) => r.id === roomId);
    if (!room) {
      this.error('Room not found in domain');
      return;
    }

    const currentTemp = roomTemperature(room);
    const targetTemp = targetTemperature(room);
    const humidity = roomHumidity(domain, room);
    const mode = roomModeFromWiser(room.Mode ?? '') ?? 'auto';

    if (currentTemp !== null) {
      await this.setCapabilityValue('measure_temperature', currentTemp).catch(this.error);
    }
    await this.setCapabilityValue('target_temperature', targetTemp ?? MIN_TARGET_TEMP).catch(this.error);
    if (humidity !== null) {
      this.log('Room humidity:', humidity);
      await this.setCapabilityValue('measure_humidity', humidity).catch(this.error);
    } else {
      this.log('No humidity available for room', roomId);
    }
    await this.setCapabilityValue(ROOM_MODE_CAPABILITY, mode).catch(this.error);
    await this.setSettings({ roomMode: mode }).catch(this.error);
    if (!this.hasCurrentDomain(domain, sourceHub)) return;
    await this.updateAvailability('available');
    if (!this.hasCurrentDomain(domain, sourceHub)) {
      const health = this.getManager().get(this.getHubId())?.getHealth()
        ?? { available: false, reason: 'not_ready', lastSuccessAt: null };
      await this.onHealth(health);
    }
  }

  private async teardown(): Promise<void> {
    this.active = false;
    this.getManager().unsubscribe(this.getHubId(), `room:${this.getRoomId()}`);
    this.getManager().unsubscribeHealth(this.getHubId(), `room:${this.getRoomId()}`);
  }

  async onUninit(): Promise<void> {
    await this.teardown();
  }

  async onSettings({
    changedKeys,
    newSettings,
  }: {
    oldSettings: Record<string, unknown>;
    newSettings: Record<string, unknown>;
    changedKeys: string[];
  }): Promise<void> {
    if (changedKeys.includes('roomMode')) {
      const hub = this.getManager().get(this.getHubId());
      if (!hub) throw new Error('Hub not available');
      await hub.getClient().setRoomMode(this.getRoomId(), newSettings.roomMode as RoomMode);
      await hub.poll();
    }
  }

  async onDeleted(): Promise<void> {
    await this.teardown();
  }
}

module.exports = RoomDevice;
