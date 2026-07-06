import Homey from 'homey';
import { WiserHub } from '../../lib/wiser-hub';
import { WiserClient } from '../../lib/wiser-client';
import WiserHubManager from '../../lib/wiser-hub-manager';
import { hotWaterModeFromWiser, type HotWaterMode } from '../../lib/wiser-utils';
import type { WiserDomain } from '../../lib/wiser-types';

interface HubApp extends Homey.App {
  hubManager: WiserHubManager;
}

class HotWaterDevice extends Homey.Device {
  private hub: WiserHub | null = null;
  private ownsHub = false;

  async onInit(): Promise<void> {
    this.log('Wiser HotWater device init:', this.getName());
    await this.migrateCapabilities();
    await this.setupHotWater();
  }

  private async migrateCapabilities(): Promise<void> {
    if (this.hasCapability('onoff')) {
      await this.removeCapability('onoff');
    }
    if (this.hasCapability('wiser_hotwater_state')) {
      await this.removeCapability('wiser_hotwater_state');
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
    await this.setCapabilityValue('wiser_hotwater_mode', mode).catch(this.error);
    await this.setAvailable();
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

  async onDeleted(): Promise<void> {
    await this.teardown();
  }
}

module.exports = HotWaterDevice;
