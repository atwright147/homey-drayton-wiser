import Homey from 'homey';
import { WiserClient } from '../../lib/wiser-client';
import { WiserHub, type HubHealthStatus, type HubUnavailableReason } from '../../lib/wiser-hub';
import WiserHubManager from '../../lib/wiser-hub-manager';
import {
  signalPercentFromRssi,
  signalPercentFromDisplayed,
  booleanFromWiser,
  binaryModeFromBoolean,
  binaryModeToBoolean,
  validTemperatureFromApi,
} from '../../lib/wiser-utils';
import type { WiserDomain } from '../../lib/wiser-types';

interface HubApp extends Homey.App {
  hubManager: WiserHubManager;
}

interface DiscoveryCandidate {
  id: string;
  address: string;
}

interface ObservedDiscoveryResult {
  result: Homey.DiscoveryResultMDNSSD;
  onAddressChanged: () => void;
}

class HubDevice extends Homey.Device {
  private hub: WiserHub | null = null;
  private client: WiserClient | null = null;
  private active = false;
  private homeAwayState: 'home' | 'away' | null = null;
  private terminated = false;
  private availabilityTarget: HubUnavailableReason | 'available' | 'unknown' = 'unknown';
  private availabilityTask: Promise<void> = Promise.resolve();
  private effectiveUseHttps = false;
  private discoveryStrategy: Homey.DiscoveryStrategy | null = null;
  private readonly observedResults: Map<string, ObservedDiscoveryResult> = new Map();
  private discoveryQueue: Promise<void> = Promise.resolve();

  repairConnection(data: { ip: string; secret?: string; discoveryId?: string | null }, sessionActive: () => boolean): Promise<void> {
    const task = this.discoveryQueue.then(() => this.applyRepair(data, sessionActive));
    this.discoveryQueue = task.catch(() => {});
    return task;
  }

  private getExpectedChipId(): string | null {
    const stored = this.getStoreValue('chipId') as string | undefined;
    if (stored) return stored;
    const id = this.getData().id as string;
    return id && id !== this.getStoreValue('address') ? id : null;
  }

  private async applyRepair(
    data: { ip: string; secret?: string; discoveryId?: string | null },
    sessionActive: () => boolean,
  ): Promise<void> {
    const address = typeof data?.ip === 'string' ? data.ip.trim() : '';
    const secret = (typeof data?.secret === 'string' ? data.secret.trim() : '')
      || this.getStoreValue('secret') as string | undefined;
    if (!address || !secret) throw new Error('Enter the hub IP address and secret key.');
    if (this.terminated || !sessionActive()) throw new Error('Repair session has ended. Open Repair again.');
    const expectedChipId = this.getExpectedChipId();
    if (!expectedChipId) {
      throw new Error('This older device has no saved hub identity. Restore its original connection first so it can learn the identity, then retry Repair.');
    }
    const checkDiscovery = (): void => {
      if (!data.discoveryId) return;
      const selected = Object.values(this.driver.getDiscoveryStrategy().getDiscoveryResults())
        .find((result) => result.id === data.discoveryId);
      if (!selected || selected.address !== address) {
        throw new Error('The selected hub has moved. Select it again or enter its current IP address manually.');
      }
    };
    checkDiscovery();
    const useHttps = this.effectiveUseHttps;
    const verifier = new WiserClient({ host: address, secret, useHttps });
    let domain: WiserDomain | null;
    try {
      domain = await verifier.verifyConnectionWithDomain();
    } catch {
      throw new Error('Could not connect to the Wiser hub. Check the IP address and secret.');
    } finally {
      await verifier.dispose();
    }
    if (domain?.System?.BrandName !== 'WiserHeat') {
      throw new Error('Could not connect to the Wiser hub. Check the IP address and secret.');
    }
    if (domain.System.ChipId == null || String(domain.System.ChipId) !== expectedChipId) {
      throw new Error('This is a different HeatHub. Repair must connect to the originally paired hub.');
    }
    if (this.terminated || !sessionActive()) throw new Error('Repair session has ended. Open Repair again.');
    if (useHttps !== this.effectiveUseHttps) throw new Error('Connection settings changed. Try Repair again.');
    checkDiscovery();
    const updates: Record<string, unknown> = {
      address, secret, chipId: expectedChipId, discoveryId: data.discoveryId || null,
    };
    const previous = Object.fromEntries(Object.keys(updates).map((key) => [key, this.getStoreValue(key)]));
    try {
      for (const [key, value] of Object.entries(updates)) await this.setStoreValue(key, value);
      if (this.terminated) throw new Error('Device has stopped.');
    } catch {
      for (const [key, value] of Object.entries(previous)) {
        try {
          if (value === undefined) await this.unsetStoreValue(key);
          else await this.setStoreValue(key, value);
        } catch {
          this.error('Could not restore a hub connection setting after failed repair:', key);
        }
      }
      throw new Error('Could not save the repaired connection. Try Repair again.');
    }
    if (this.hub) {
      this.client = new WiserClient({ host: address, secret, useHttps: this.effectiveUseHttps });
      this.hub.setClient(this.client);
    } else {
      await this.setupHub();
      if (this.active) this.startDiscoveryMonitoring();
    }
  }

  private readonly onStrategyResult = (result: Homey.DiscoveryResultMDNSSD): void => {
    this.observeDiscoveryResult(result);
  };

  async onInit(): Promise<void> {
    this.log('Wiser HeatHub device init:', this.getName());
    await this.migrateCapabilities();
    await this.setCapabilityValue('wiser_comfort_mode', 'off').catch(this.error);
    await this.setCapabilityValue('wiser_eco_mode', 'off').catch(this.error);
    await this.setupHub();
    if (this.active) this.startDiscoveryMonitoring();
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

  private async migrateCapabilities(): Promise<void> {
    for (const capability of ['wiser_home_away_mode', 'measure_away_temperature']) {
      if (!this.hasCapability(capability)) await this.addCapability(capability);
    }
  }

  private async setAwayMode(enabled: boolean): Promise<void> {
    if (!this.client) throw new Error('Hub client not ready');
    await this.client.setAwayMode(enabled);
    await this.hub?.poll();
  }

  private getManager(): WiserHubManager {
    return (this.homey.app as HubApp).hubManager;
  }

  private startDiscoveryMonitoring(): void {
    const strategy = this.driver.getDiscoveryStrategy();
    this.discoveryStrategy = strategy;
    strategy.on('result', this.onStrategyResult);
    for (const result of Object.values(strategy.getDiscoveryResults())) {
      this.observeDiscoveryResult(result as Homey.DiscoveryResultMDNSSD);
    }
  }

  private stopDiscoveryMonitoring(): void {
    this.discoveryStrategy?.off('result', this.onStrategyResult);
    for (const { result, onAddressChanged } of this.observedResults.values()) {
      result.off('addressChanged', onAddressChanged);
    }
    this.observedResults.clear();
    this.discoveryStrategy = null;
  }

  private observeDiscoveryResult(result: Homey.DiscoveryResultMDNSSD): void {
    if (!result?.id || !result.address) return;
    const previous = this.observedResults.get(result.id);
    if (previous?.result !== result) {
      if (previous) previous.result.off('addressChanged', previous.onAddressChanged);
      const onAddressChanged = (): void => this.enqueueDiscoveryCandidate(result);
      result.on('addressChanged', onAddressChanged);
      this.observedResults.set(result.id, { result, onAddressChanged });
    }
    this.enqueueDiscoveryCandidate(result);
  }

  private enqueueDiscoveryCandidate(result: Homey.DiscoveryResultMDNSSD): void {
    const candidate = { id: result.id, address: result.address };
    this.discoveryQueue = this.discoveryQueue.then(() => this.applyDiscoveryCandidate(candidate)).catch((err) => {
      this.error('Could not process Wiser discovery result:', err);
    });
  }

  private async applyDiscoveryCandidate(candidate: DiscoveryCandidate): Promise<void> {
    if (!this.active || !candidate.id || !candidate.address) return;
    const storedDiscoveryId = this.getStoreValue('discoveryId') as string | undefined;
    if (storedDiscoveryId && storedDiscoveryId !== candidate.id) return;
    const storedAddress = this.getStoreValue('address') as string | undefined;
    if (storedDiscoveryId === candidate.id && storedAddress === candidate.address) return;
    const secret = this.getStoreValue('secret') as string | undefined;
    const pairedChipId = this.getExpectedChipId();
    if (!secret || !pairedChipId) return;

    const useHttps = this.effectiveUseHttps;
    const verifier = new WiserClient({ host: candidate.address, secret, useHttps });
    let domain: WiserDomain | null;
    try {
      domain = await verifier.verifyConnectionWithDomain();
    } finally {
      await verifier.dispose();
    }
    if (!this.active || domain?.System?.BrandName !== 'WiserHeat'
      || String(domain.System.ChipId) !== String(pairedChipId)) return;
    const currentResult = Object.values(this.discoveryStrategy?.getDiscoveryResults() ?? {})
      .find((result) => result.id === candidate.id);
    if (!currentResult || currentResult.address !== candidate.address) return;

    if (storedDiscoveryId !== candidate.id) {
      await this.setStoreValue('discoveryId', candidate.id);
      if (!this.active) return;
    }
    if (storedAddress === candidate.address) return;
    await this.setStoreValue('address', candidate.address);
    if (!this.active || !this.hub) return;
    this.client = new WiserClient({ host: candidate.address, secret, useHttps: this.effectiveUseHttps });
    this.hub.setClient(this.client);
  }

  onDiscoveryResult(result: Homey.DiscoveryResultMDNSSD): boolean {
    const discoveryId = this.getStoreValue('discoveryId') as string | undefined;
    return !!discoveryId && result.id === discoveryId;
  }

  onDiscoveryAvailable(result: Homey.DiscoveryResultMDNSSD): void {
    this.observeDiscoveryResult(result);
  }

  onDiscoveryAddressChanged(result: Homey.DiscoveryResultMDNSSD): void {
    this.observeDiscoveryResult(result);
  }

  private async setupHub(): Promise<void> {
    this.effectiveUseHttps = Boolean(this.getSettings().useHttps);
    const address = this.getStoreValue('address') as string | undefined;
    const secret = this.getStoreValue('secret') as string | undefined;
    if (!address || !secret) {
      await this.setUnavailable('No hub address or secret configured. Please repair the device.');
      this.error('Missing address or secret in store');
      return;
    }

    const settings = this.getSettings();
    const useHttps = Boolean(settings.useHttps);
    this.effectiveUseHttps = useHttps;
    const intervalMs = Number(settings.pollInterval ?? 30) * 1000;

    this.client = new WiserClient({ host: address, secret, useHttps });
    this.hub = new WiserHub({ client: this.client, intervalMs });

    const id = this.getData().id as string;
    this.active = true;
    this.getManager().register(id, this.hub);

    this.hub.register(`hub:${id}`, (domain) => this.onPoll(domain));
    this.hub.registerHealth(`hub:${id}`, (health) => this.onHealth(health));
    this.hub.start();

    this.registerCapabilityListener('wiser_away_mode', async (value: boolean) => {
      await this.setAwayMode(value);
    });

    this.registerCapabilityListener('wiser_home_away_mode', async (value: string) => {
      if (value !== 'home' && value !== 'away') throw new Error('Invalid Home/Away mode');
      await this.setAwayMode(value === 'away');
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

  private updateAvailability(target: HubUnavailableReason | 'available'): Promise<void> {
    if (this.availabilityTarget === target) return this.availabilityTask;
    this.availabilityTarget = target;
    this.availabilityTask = this.availabilityTask.then(async () => {
      if (this.availabilityTarget !== target || !this.active) return;
      if (target === 'available') {
        await this.setAvailable();
        return;
      }
      let message = 'Wiser HeatHub is not ready.';
      if (target === 'authentication') message = 'Wiser HeatHub authentication failed. Check the secret.';
      if (target === 'connection') message = 'Could not connect to the Wiser HeatHub.';
      await this.setUnavailable(message);
    }).catch((err) => {
      this.error('Could not update hub availability:', err);
      if (this.availabilityTarget === target) this.availabilityTarget = 'unknown';
    });
    return this.availabilityTask;
  }

  private async onHealth(health: HubHealthStatus): Promise<void> {
    if (!this.active || health.available || !health.reason || this.hub?.getDomain()) return;
    const currentHub = this.getManager().get(this.getData().id as string);
    const current = currentHub?.getHealth();
    if (current && (current.available !== health.available || current.reason !== health.reason)) return;
    await this.updateAvailability(health.reason);
  }

  private hasCurrentDomain(domain: WiserDomain): boolean {
    return this.active && !!this.hub && this.getManager().get(this.getData().id as string) === this.hub
      && this.hub.getDomain() === domain;
  }

  private async onPoll(domain: WiserDomain): Promise<void> {
    try {
      if (this.hasCurrentDomain(domain) && !this.getExpectedChipId()
        && domain.System?.BrandName === 'WiserHeat' && domain.System.ChipId) {
        await this.setStoreValue('chipId', String(domain.System.ChipId));
      }
      const overrideType = domain.System?.OverrideType;
      let awayMode: boolean | null = null;
      if (overrideType === 'Away') awayMode = true;
      else if (overrideType === 'None') awayMode = false;
      else if (typeof domain.System?.AwayMode === 'boolean') awayMode = domain.System.AwayMode;
      else if (overrideType == null && domain.System) awayMode = false;
      const awayTemperature = domain.System?.AwayModeSetPointLimit;
      const awayTarget = awayTemperature != null && Number.isFinite(awayTemperature)
        ? validTemperatureFromApi(awayTemperature) : null;
      let homeAwayMode: 'home' | 'away' | null = null;
      if (awayMode != null) homeAwayMode = awayMode ? 'away' : 'home';
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

      await this.setCapabilityValue('wiser_home_away_mode', homeAwayMode).catch(this.error);
      await this.setCapabilityValue('measure_away_temperature', awayTarget).catch(this.error);
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
      await this.setSettings({
        firmwareVersion: domain.System?.ActiveSystemVersion ?? '',
        hardwareGeneration: domain.System?.HardwareGeneration != null ? String(domain.System.HardwareGeneration) : '',
        brandName: domain.System?.BrandName ?? '',
        serialNumber: controller?.SerialNumber ?? '',
        zigbeeModuleVersion: domain.Zigbee?.ZigbeeModuleVersion ?? '',
        zigbeeChannel: domain.Zigbee?.NetworkChannel != null ? String(domain.Zigbee.NetworkChannel) : '',
        openthermStatus: domain.System?.OpenThermConnectionStatus ?? '',
      }).catch(this.error);
      if (!this.hasCurrentDomain(domain)) return;
      await this.updateAvailability('available');
      if (!this.hasCurrentDomain(domain)) {
        const health = this.getManager().get(this.getData().id as string)?.getHealth()
          ?? { available: false, reason: 'not_ready', lastSuccessAt: null };
        await this.onHealth(health);
        return;
      }
      if (homeAwayMode) {
        const previous = this.homeAwayState;
        this.homeAwayState = homeAwayMode;
        if (previous && previous !== homeAwayMode) {
          await this.homey.flow?.getDeviceTriggerCard('home_away_changed')
            .trigger(this, { mode: homeAwayMode }).catch(this.error);
        }
      }
    } catch (err) {
      this.error('onPoll error:', err);
    }
  }

  async onUninit(): Promise<void> {
    this.terminated = true;
    this.active = false;
    this.stopDiscoveryMonitoring();
    if (this.hub) {
      this.hub.unregisterHealth(`hub:${this.getData().id as string}`);
      this.getManager().unregister(this.getData().id as string, this.hub);
    }
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
      if (!this.hub) throw new Error('Hub not ready');
      if (changedKeys.includes('useHttps')) {
        const address = this.getStoreValue('address') as string;
        const secret = this.getStoreValue('secret') as string;
        this.effectiveUseHttps = Boolean(newSettings.useHttps);
        this.client = new WiserClient({ host: address, secret, useHttps: this.effectiveUseHttps });
        this.hub.setClient(this.client);
      }
      if (changedKeys.includes('pollInterval')) {
        this.hub.setInterval(Number(newSettings.pollInterval) * 1000);
      }
    }
  }

  async onDeleted(): Promise<void> {
    this.terminated = true;
    this.active = false;
    this.stopDiscoveryMonitoring();
    if (this.hub) {
      this.hub.unregisterHealth(`hub:${this.getData().id as string}`);
      this.getManager().unregister(this.getData().id as string, this.hub);
    }
  }
}

module.exports = HubDevice;
