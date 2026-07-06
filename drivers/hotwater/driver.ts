import Homey from 'homey';
import { WiserHub } from '../../lib/wiser-hub';
import { WiserClient } from '../../lib/wiser-client';
import WiserHubManager from '../../lib/wiser-hub-manager';
import type { WiserDomain } from '../../lib/wiser-types';

interface HubApp extends Homey.App {
  hubManager: WiserHubManager;
}

interface HotWaterPairDevice {
  name: string;
  data: { id: string };
  store: {
    hubId: string;
    hotWaterId: number;
    address: string;
    secret: string;
    useHttps: boolean;
  };
}

class HotWaterDriver extends Homey.Driver {
  async onPairListDevices(): Promise<HotWaterPairDevice[]> {
    const hubDriver = this.homey.drivers.getDriver('hub');
    const hubDevices = hubDriver.getDevices();
    this.log('HotWater pair: found', hubDevices.length, 'hub devices');
    const result: HotWaterPairDevice[] = [];

    for (const hubDevice of hubDevices) {
      const hubId = hubDevice.getData().id as string;
      this.log('HotWater pair: checking hub', hubId);
      const domain = await this.fetchDomain(hubDevice);
      if (!domain) {
        this.log('HotWater pair: no domain for hub', hubId);
        continue;
      }

      const address = hubDevice.getStoreValue('address') as string;
      const secret = hubDevice.getStoreValue('secret') as string;
      const useHttps = Boolean(hubDevice.getSetting('useHttps'));
      if (!address || !secret) {
        this.log('HotWater pair: missing address or secret for hub', hubId);
        continue;
      }

      const hotWaterItems = domain.HotWater ?? [];
      this.log('HotWater pair: found', hotWaterItems.length, 'hot water items for hub', hubId);
      for (const hotWater of hotWaterItems) {
        result.push({
          name: 'Wiser Hot Water',
          data: { id: `hotwater-${hubId}-${hotWater.id}` },
          store: {
            hubId,
            hotWaterId: hotWater.id,
            address,
            secret,
            useHttps,
          },
        });
      }
    }

    this.log('HotWater pair: returning', result.length, 'devices');
    return result;
  }

  private async fetchDomain(hubDevice: Homey.Device): Promise<WiserDomain | null> {
    const hubId = hubDevice.getData().id as string;
    const manager = (this.homey.app as HubApp).hubManager;
    const hub = manager.get(hubId);
    const cached = hub?.getDomain();
    if (cached) {
      this.log('HotWater pair: using cached domain for hub', hubId);
      return cached;
    }
    if (hub) {
      this.log('HotWater pair: polling managed hub', hubId);
      const polled = await hub.poll();
      if (polled) {
        return polled;
      }
    }

    const address = hubDevice.getStoreValue('address') as string;
    const secret = hubDevice.getStoreValue('secret') as string;
    const useHttps = Boolean(hubDevice.getSetting('useHttps'));
    if (!address || !secret) {
      this.log('HotWater pair: missing address or secret for direct poll', hubId);
      return null;
    }

    try {
      this.log('HotWater pair: direct polling hub', hubId, 'at', address);
      const client = new WiserClient({ host: address, secret, useHttps });
      const tempHub = new WiserHub({ client });
      return await tempHub.poll();
    } catch (err) {
      this.error('HotWater pair: direct poll failed for hub', hubId, err);
      return null;
    }
  }
}

module.exports = HotWaterDriver;
