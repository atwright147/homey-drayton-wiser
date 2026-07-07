import Homey from 'homey';
import { WiserClient } from '../../lib/wiser-client';
import { WiserHub } from '../../lib/wiser-hub';
import WiserHubManager from '../../lib/wiser-hub-manager';
import {
  signalPercentFromRssi,
  signalPercentFromDisplayed,
  booleanFromWiser,
  binaryModeFromBoolean,
  binaryModeToBoolean,
} from '../../lib/wiser-utils';
import type { WiserDomain } from '../../lib/wiser-types';

interface HubApp extends Homey.App {
  hubManager: WiserHubManager;
}

class HubDevice extends Homey.Device {
  private hub: WiserHub | null = null;
  private client: WiserClient | null = null;

  async onInit(): Promise<void> {
    this.log('Wiser HeatHub device init:', this.getName());
    await this.setCapabilityValue('wiser_comfort_mode', 'off').catch(this.error);
    await this.setCapabilityValue('wiser_eco_mode', 'off').catch(this.error);
    await this.setupHub();
  }

  private toBinaryModeBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      return binaryModeToBoolean(value);
    }
    return false;
  }

  private getManager(): WiserHubManager {
    return (this.homey.app as HubApp).hubManager;
  }

  private async setupHub(): Promise<void> {
    const address = this.getStoreValue('address') as string | undefined;
    const secret = this.getStoreValue('secret') as string | undefined;
    if (!address || !secret) {
      await this.setUnavailable('No hub address or secret configured. Please re-pair the device.');
      this.error('Missing address or secret in store');
      return;
    }

    const settings = this.getSettings();
    const useHttps = Boolean(settings.useHttps);
    const intervalMs = Number(settings.pollInterval ?? 30) * 1000;

    this.client = new WiserClient({ host: address, secret, useHttps });
    this.hub = new WiserHub({ client: this.client, intervalMs });

    const id = this.getData().id as string;
    const manager = this.getManager();
    if (manager) {
      manager.register(id, this.hub);
    }

    this.hub.register(`hub:${id}`, (domain) => this.onPoll(domain));
    this.hub.start();

    this.registerCapabilityListener('wiser_away_mode', async (value: boolean) => {
      if (!this.client) throw new Error('Hub client not ready');
      await this.client.setAwayMode(value);
      await this.hub?.poll();
    });

    this.registerCapabilityListener('wiser_comfort_mode', async (value: string | boolean) => {
      if (!this.client) throw new Error('Hub client not ready');
      await this.client.setComfortMode(this.toBinaryModeBoolean(value));
      await this.hub?.poll();
    });

    this.registerCapabilityListener('wiser_eco_mode', async (value: string | boolean) => {
      if (!this.client) throw new Error('Hub client not ready');
      await this.client.setEcoMode(this.toBinaryModeBoolean(value));
      await this.hub?.poll();
    });
  }

  private async onPoll(domain: WiserDomain): Promise<void> {
    try {
      const awayMode = booleanFromWiser(domain.System?.AwayMode);
      const comfortMode = booleanFromWiser(domain.System?.ComfortModeEnabled);
      const ecoMode = booleanFromWiser(domain.System?.EcoModeEnabled);
      const heatingActive = (domain.HeatingChannel ?? []).some(
        (ch) => ch.HeatingRelayState === 'On',
      );
      const cloudConnected = domain.System?.CloudConnectionStatus === 'Connected';

      const controller = (domain.Device ?? []).find((d) => d.ProductType === 'Controller');
      let signal = 0;
      if (controller?.ReceptionOfController?.Rssi != null) {
        signal = signalPercentFromRssi(controller.ReceptionOfController.Rssi);
      } else if (controller?.DisplayedSignalStrength) {
        signal = signalPercentFromDisplayed(controller.DisplayedSignalStrength) ?? 0;
      }

      await this.setCapabilityValue('wiser_away_mode', awayMode).catch(this.error);
      await this.setCapabilityValue('wiser_comfort_mode', binaryModeFromBoolean(comfortMode)).catch(this.error);
      await this.setCapabilityValue('wiser_eco_mode', binaryModeFromBoolean(ecoMode)).catch(this.error);
      await this.setSettings({
        comfortMode: binaryModeFromBoolean(comfortMode),
        ecoMode: binaryModeFromBoolean(ecoMode),
      }).catch(this.error);
      await this.setCapabilityValue('wiser_heating_active', heatingActive).catch(this.error);
      await this.setCapabilityValue('wiser_cloud_connected', cloudConnected).catch(this.error);
      await this.setCapabilityValue('measure_signal', signal).catch(this.error);
      await this.setAvailable();
    } catch (err) {
      this.error('onPoll error:', err);
    }
  }

  async onUninit(): Promise<void> {
    this.hub?.stop();
  }

  async onSettings({
    changedKeys,
    newSettings,
  }: {
    oldSettings: Record<string, unknown>;
    newSettings: Record<string, unknown>;
    changedKeys: string[];
  }): Promise<void> {
    if (changedKeys.includes('comfortMode')) {
      if (!this.client) throw new Error('Hub client not ready');
      await this.client.setComfortMode(this.toBinaryModeBoolean(newSettings.comfortMode));
      await this.hub?.poll();
    }
    if (changedKeys.includes('ecoMode')) {
      if (!this.client) throw new Error('Hub client not ready');
      await this.client.setEcoMode(this.toBinaryModeBoolean(newSettings.ecoMode));
      await this.hub?.poll();
    }
    if (changedKeys.includes('pollInterval') || changedKeys.includes('useHttps')) {
      this.hub?.stop();
      const id = this.getData().id as string;
      const manager = this.getManager();
      if (manager && manager.has(id)) {
        manager.unregister(id);
      }
      await this.setupHub();
    }
  }

  async onDeleted(): Promise<void> {
    this.hub?.stop();
    const id = this.getData().id as string;
    const manager = this.getManager();
    if (manager) {
      manager.unregister(id);
    }
  }
}

module.exports = HubDevice;
