import Homey from 'homey';
import WiserHubManager from '../../lib/wiser-hub-manager';
import { hotWaterModeFromWiser, formatNextHotWaterEvent, type HotWaterMode } from '../../lib/wiser-utils';
import type { WiserDomain, WiserSchedule, WiserHotWater } from '../../lib/wiser-types';

interface HubApp extends Homey.App {
  hubManager: WiserHubManager;
}

const BOOST_30_CAPABILITY = 'wiser_hotwater_boost_30';
const BOOST_60_CAPABILITY = 'wiser_hotwater_boost_60';
const CANCEL_BOOST_CAPABILITY = 'wiser_hotwater_boost_cancel';
const DEPRECATED_BOOST_CAPABILITIES = ['wiser_hotwater_boost_duration', 'wiser_hotwater_boost'];

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
    for (const capability of DEPRECATED_BOOST_CAPABILITIES) {
      if (this.hasCapability(capability)) {
        try {
          await this.removeCapability(capability);
        } catch (err) {
          this.error('Failed to remove deprecated capability', capability, err);
        }
      }
    }
    const capabilities = [
      'wiser_hotwater_state',
      'wiser_hotwater_next_event',
      BOOST_30_CAPABILITY,
      BOOST_60_CAPABILITY,
      CANCEL_BOOST_CAPABILITY,
    ];
    for (const capability of capabilities) {
      if (!this.hasCapability(capability)) {
        await this.addCapability(capability);
      }
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
    const manager = this.getManager();
    manager.subscribe(hubId, `hotwater:${hotWaterId}`, (domain) => this.onPoll(domain));
    const hub = manager.get(hubId);
    if (!hub) {
      await this.setUnavailable('The parent Wiser HeatHub is not available.');
    } else {
      await hub.poll();
    }

    this.registerCapabilityListener('wiser_hotwater_mode', async (value: string) => {
      const currentHub = this.getManager().get(hubId);
      if (!currentHub) throw new Error('Hub not available');
      await currentHub.getClient().setHotWaterMode(hotWaterId, value as HotWaterMode);
      await currentHub.poll();
    });

    this.registerCapabilityListener(BOOST_30_CAPABILITY, async () => this.boostHotWater(30));

    this.registerCapabilityListener(BOOST_60_CAPABILITY, async () => this.boostHotWater(60));

    this.registerCapabilityListener(CANCEL_BOOST_CAPABILITY, async () => this.cancelHotWaterBoost());
  }

  private async boostHotWater(minutes: number): Promise<void> {
    const hub = this.getManager().get(this.getHubId());
    if (!hub) throw new Error('Hub not available');
    await hub.getClient().setHotWaterOverride(this.getHotWaterId(), minutes);
    await hub.poll();
  }

  private async cancelHotWaterBoost(): Promise<void> {
    const hub = this.getManager().get(this.getHubId());
    if (!hub) throw new Error('Hub not available');
    await hub.getClient().cancelHotWaterOverride(this.getHotWaterId());
    await hub.poll();
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
    this.getManager().unsubscribe(this.getHubId(), `hotwater:${this.getHotWaterId()}`);
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
      const hub = this.getManager().get(this.getHubId());
      if (!hub) throw new Error('Hub not available');
      await hub.getClient().setHotWaterMode(this.getHotWaterId(), newSettings.hotWaterMode as HotWaterMode);
      await hub.poll();
    }
  }

  async onDeleted(): Promise<void> {
    await this.teardown();
  }
}

module.exports = HotWaterDevice;
