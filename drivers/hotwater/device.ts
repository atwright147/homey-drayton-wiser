import Homey from 'homey';
import { WiserHub } from '../../lib/wiser-hub';
import { WiserClient } from '../../lib/wiser-client';
import WiserHubManager from '../../lib/wiser-hub-manager';
import { hotWaterModeFromWiser, formatNextHotWaterEvent, type HotWaterMode } from '../../lib/wiser-utils';
import type { WiserDomain, WiserSchedule, WiserHotWater } from '../../lib/wiser-types';

interface HubApp extends Homey.App {
  hubManager: WiserHubManager;
}

function hotWaterState(hotWater: WiserHotWater): boolean {
  if (hotWater.WaterHeatingState != null) {
    return hotWater.WaterHeatingState === 'On';
  }
  if (hotWater.HotWaterRelayState != null) {
    return hotWater.HotWaterRelayState === 'On';
  }
  return false;
}

class HotWaterDevice extends Homey.Device {
  private hub: WiserHub | null = null;
  private ownsHub = false;

  async onInit(): Promise<void> {
    this.log('Wiser HotWater device init:', this.getName());
    await this.setCapabilityValue('wiser_hotwater_mode', 'auto').catch(this.error);
    await this.migrateCapabilities();
    await this.setupHotWater();
  }

  private async migrateCapabilities(): Promise<void> {
    if (this.hasCapability('onoff')) {
      await this.removeCapability('onoff');
    }
    if (!this.hasCapability('wiser_hotwater_state')) {
      await this.addCapability('wiser_hotwater_state');
    }
    if (!this.hasCapability('wiser_hotwater_next_event')) {
      await this.addCapability('wiser_hotwater_next_event');
    }
  }

  private getManager(): WiserHubManager {
    return (this.homey.app as HubApp).hubManager;
  }

  private getHotWaterId(): number {
    return this.getStoreValue('hotWaterId') as number;
  }

  private getHubId(): string {
    return this.getStoreValue('hubId') as string;
  }

  private async setupHotWater(): Promise<void> {
    const hubId = this.getHubId();
    const hotWaterId = this.getHotWaterId();
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
      this.error('No hub found for hot water');
      return;
    }

    this.hub.register(`hotwater:${hotWaterId}`, (domain) => this.onPoll(domain));
    await this.hub.poll();

    this.registerCapabilityListener('wiser_hotwater_mode', async (value: string) => {
      if (!this.hub) {
        throw new Error('Hub not available');
      }
      await this.hub.getClient().setHotWaterMode(hotWaterId, value as HotWaterMode);
      await this.hub.poll();
    });
  }

  private async onPoll(domain: WiserDomain): Promise<void> {
    const hotWaterId = this.getHotWaterId();
    const hotWater = domain.HotWater?.find((hw) => hw.id === hotWaterId);
    if (!hotWater) {
      this.error('Hot water not found in domain');
      return;
    }

    const mode = hotWaterModeFromWiser(hotWater.Mode ?? '') ?? 'auto';
    const state = hotWaterState(hotWater);
    const schedule = this.findHotWaterSchedule(domain, hotWater.ScheduleId);
    const nextEvent = formatNextHotWaterEvent(schedule);

    this.log('HotWater poll: scheduleId', hotWater.ScheduleId, 'schedule found', !!schedule, 'nextEvent', nextEvent);
    if (!schedule) {
      this.log('HotWater poll: domain.Schedule ids', domain.Schedule?.map((s) => s.id));
    }

    await this.setCapabilityValue('wiser_hotwater_state', state).catch(this.error);
    await this.setCapabilityValue('wiser_hotwater_mode', mode).catch(this.error);
    await this.setSettings({ hotWaterMode: mode }).catch(this.error);
    await this.setCapabilityValue('wiser_hotwater_next_event', nextEvent ?? 'No schedule').catch(this.error);
    await this.setAvailable();
  }

  private findHotWaterSchedule(domain: WiserDomain, scheduleId?: number): WiserSchedule | undefined {
    if (scheduleId == null) {
      return undefined;
    }
    return domain.Schedule?.find((s) => s.id === scheduleId);
  }

  private async teardown(): Promise<void> {
    const hotWaterId = this.getHotWaterId();
    const hubId = this.getHubId();
    this.hub?.unregister(`hotwater:${hotWaterId}`);
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
    if (changedKeys.includes('hotWaterMode')) {
      if (!this.hub) throw new Error('Hub not available');
      await this.hub.getClient().setHotWaterMode(this.getHotWaterId(), newSettings.hotWaterMode as HotWaterMode);
      await this.hub.poll();
    }
  }

  async onDeleted(): Promise<void> {
    await this.teardown();
  }
}

module.exports = HotWaterDevice;
