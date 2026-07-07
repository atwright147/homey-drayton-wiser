import Homey from 'homey';
import { WiserHub } from '../../lib/wiser-hub';
import { WiserClient } from '../../lib/wiser-client';
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
  private hub: WiserHub | null = null;
  private ownsHub = false;

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
    const address = this.getStoreValue('address') as string;
    const secret = this.getStoreValue('secret') as string;

    const manager = this.getManager();
    this.hub = manager.get(hubId) ?? null;

    if (!this.hub && address && secret) {
      const useHttps = Boolean(this.getStoreValue('useHttps'));
      const client = new WiserClient({ host: address, secret, useHttps });
      this.hub = new WiserHub({ client });
      manager.register(hubId, this.hub);
      this.ownsHub = true;
    }

    if (!this.hub) {
      await this.setUnavailable('The parent Wiser HeatHub is not available.');
      this.error('No hub found for room');
      return;
    }

    this.hub.register(`room:${roomId}`, (domain) => this.onPoll(domain));
    await this.hub.poll();

    this.registerCapabilityListener('target_temperature', async (value: number) => {
      if (!this.hub) {
        throw new Error('Hub not available');
      }
      await this.hub.getClient().setRoomSetpoint(roomId, value);
      await this.hub.poll();
    });

    this.registerCapabilityListener(ROOM_MODE_CAPABILITY, async (value: string) => {
      if (!this.hub) {
        throw new Error('Hub not available');
      }
      await this.hub.getClient().setRoomMode(roomId, value as RoomMode);
      await this.hub.poll();
    });
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
    const roomId = this.getRoomId();
    const hubId = this.getHubId();
    this.hub?.unregister(`room:${roomId}`);
    if (this.ownsHub) {
      this.hub?.stop();
      this.getManager().unregister(hubId);
    }
    this.hub = null;
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
      if (!this.hub) throw new Error('Hub not available');
      await this.hub.getClient().setRoomMode(this.getRoomId(), newSettings.roomMode as RoomMode);
      await this.hub.poll();
    }
  }

  async onDeleted(): Promise<void> {
    await this.teardown();
  }
}

module.exports = RoomDevice;
