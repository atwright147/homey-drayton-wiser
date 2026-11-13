import Homey from 'homey';
import WiserHubManager from '../../lib/wiser-hub-manager';
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
    manager.subscribe(hubId, `room:${roomId}`, (domain) => this.onPoll(domain));

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
      await this.setUnavailable('The parent Wiser HeatHub is not available.');
    } else {
      try {
        await hub.poll();
      } catch (err) {
        this.error('Initial room poll failed:', err);
        await this.setUnavailable('Could not connect to the Wiser HeatHub.');
      }
    }
  }

  private async onPoll(domain: WiserDomain): Promise<void> {
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
    await this.setAvailable();
  }

  private async teardown(): Promise<void> {
    this.getManager().unsubscribe(this.getHubId(), `room:${this.getRoomId()}`);
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
