import Homey from 'homey';
import WiserHubManager from '../../lib/wiser-hub-manager';
import { WiserHub, type HubHealthStatus, type HubUnavailableReason } from '../../lib/wiser-hub';
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
  private active = false;
  private availabilityTarget: HubUnavailableReason | 'available' | 'unknown' = 'unknown';
  private availabilityTask: Promise<void> = Promise.resolve();

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

  private async getTimeZone(): Promise<string | null> {
    try {
      const timeZone = await this.homey.clock.getTimezone();
      if (!timeZone) throw new Error('Homey timezone is empty');
      return timeZone;
    } catch (err) {
      this.error('Could not read Homey timezone:', err);
      return null;
    }
  }

  private async setupHotWater(): Promise<void> {
    const hubId = this.getHubId();
    const hotWaterId = this.getHotWaterId();
    const manager = this.getManager();
    this.active = true;
    manager.subscribe(hubId, `hotwater:${hotWaterId}`, (domain) => this.onPoll(domain, manager.get(hubId)));
    manager.subscribeHealth(hubId, `hotwater:${hotWaterId}`, (health) => this.onHealth(health));

    this.registerCapabilityListener('wiser_hotwater_mode', async (value: string) => {
      const currentHub = this.getManager().get(hubId);
      if (!currentHub) throw new Error('Hub not available');
      await currentHub.getClient().setHotWaterMode(hotWaterId, value as HotWaterMode);
      await currentHub.poll();
    });

    this.registerCapabilityListener(BOOST_30_CAPABILITY, async () => this.boostHotWater(30));

    this.registerCapabilityListener(BOOST_60_CAPABILITY, async () => this.boostHotWater(60));

    this.registerCapabilityListener(CANCEL_BOOST_CAPABILITY, async () => this.cancelHotWaterBoost());

    const hub = manager.get(hubId);
    if (!hub) {
      await this.onHealth({ available: false, reason: 'not_ready', lastSuccessAt: null });
    } else {
      try {
        await hub.poll();
      } catch (err) {
        this.error('Initial hot water poll failed:', err);
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
      this.error('Could not update hot water availability:', err);
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

  private hasCurrentDomain(domain: WiserDomain, sourceHub: WiserHub | undefined): boolean {
    return this.active && !!sourceHub && this.getManager().get(this.getHubId()) === sourceHub
      && sourceHub.getDomain() === domain;
  }

  private async onPoll(domain: WiserDomain, sourceHub: WiserHub | undefined): Promise<void> {
    const hotWaterId = this.getHotWaterId();
    const hotWater = domain.HotWater?.find((hw) => hw.id === hotWaterId);
    if (!hotWater) {
      this.error('Hot water not found in domain');
      return;
    }

    const mode = hotWaterModeFromWiser(hotWater.Mode ?? '') ?? 'auto';
    const state = hotWaterState(hotWater);
    const schedule = this.findHotWaterSchedule(domain, hotWater.ScheduleId);
    const timeZone = schedule ? await this.getTimeZone() : null;
    if (!this.hasCurrentDomain(domain, sourceHub)) return;
    const nextEvent = schedule && timeZone ? formatNextHotWaterEvent(schedule, new Date(), timeZone) : null;
    const nextEventText = schedule && !timeZone ? 'Timezone unavailable' : nextEvent ?? 'No schedule';

    this.log('HotWater poll: scheduleId', hotWater.ScheduleId, 'schedule found', !!schedule, 'nextEvent', nextEvent);
    if (!schedule) {
      this.log('HotWater poll: domain.Schedule ids', domain.Schedule?.map((s) => s.id));
    }

    await this.setCapabilityValue('wiser_hotwater_state', state).catch(this.error);
    await this.setCapabilityValue('wiser_hotwater_mode', mode).catch(this.error);
    await this.setSettings({ hotWaterMode: mode }).catch(this.error);
    await this.setCapabilityValue('wiser_hotwater_next_event', nextEventText).catch(this.error);
    if (!this.hasCurrentDomain(domain, sourceHub)) return;
    await this.updateAvailability('available');
    if (!this.hasCurrentDomain(domain, sourceHub)) {
      const health = this.getManager().get(this.getHubId())?.getHealth()
        ?? { available: false, reason: 'not_ready', lastSuccessAt: null };
      await this.onHealth(health);
    }
  }

  private findHotWaterSchedule(domain: WiserDomain, scheduleId?: number): WiserSchedule | undefined {
    if (scheduleId == null) {
      return undefined;
    }
    return domain.Schedule?.find((s) => s.id === scheduleId);
  }

  private async teardown(): Promise<void> {
    this.active = false;
    this.getManager().unsubscribe(this.getHubId(), `hotwater:${this.getHotWaterId()}`);
    this.getManager().unsubscribeHealth(this.getHubId(), `hotwater:${this.getHotWaterId()}`);
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
