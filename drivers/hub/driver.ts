import Homey from 'homey';
import { WiserClient } from '../../lib/wiser-client';

interface DiscoveredHub {
  id: string;
  name: string;
  address: string;
}

interface HubDevice {
  name: string;
  data: { id: string };
  store: { address: string; secret: string; discoveryId?: string };
  settings: { pollInterval: number; useHttps: boolean };
}

class HubDriver extends Homey.Driver {
  async onRepair(session: Homey.Driver.PairSession, device: Homey.Device & {
    repairConnection: (data: { ip: string; secret?: string; discoveryId?: string | null }, sessionActive: () => boolean) => Promise<void>;
  }): Promise<void> {
    let active = true;
    session.setHandler('disconnect', async () => {
      active = false;
    });
    session.setHandler('repair_details', async () => ({ address: device.getStoreValue('address') ?? '' }));
    session.setHandler('discover', async (): Promise<DiscoveredHub[]> => (
      Object.values(this.getDiscoveryStrategy().getDiscoveryResults() as Record<string, Homey.DiscoveryResultMDNSSD>).map((result) => ({
        id: result.id,
        name: result.name,
        address: result.address,
      }))
    ));
    session.setHandler('repair_connection', async (data: { ip: string; secret?: string; discoveryId?: string | null }) => {
      await device.repairConnection(data, () => active);
      return true;
    });
  }

  async onInit(): Promise<void> {
    this.log('HubDriver onInit v4 - custom view');
  }

  async onPair(session: Homey.Driver.PairSession): Promise<void> {
    this.log('onPair v4 session started');
    let address = '';
    let secret = '';
    let discoveryId: string | null = null;
    let chipId: string | null = null;

    session.setHandler('discover', async (): Promise<DiscoveredHub[]> => {
      this.log('discover handler called');
      const strategy = this.getDiscoveryStrategy();
      const results = strategy.getDiscoveryResults() as Record<string, Homey.DiscoveryResultMDNSSD>;
      this.log('discovery results:', Object.keys(results));
      return Object.values(results).map((result) => ({
        id: result.id,
        name: result.name,
        address: result.address,
      }));
    });

    session.setHandler('login', async (data: { ip: string; secret: string; discoveryId?: string | null }): Promise<boolean> => {
      this.log('Login handler called with ip:', data.ip);
      address = data.ip.trim();
      secret = data.secret.trim();

      if (!address || !secret) {
        this.log('Missing address or secret');
        return false;
      }

      discoveryId = null;
      chipId = null;
      if (data.discoveryId) {
        const results = this.getDiscoveryStrategy().getDiscoveryResults();
        const selected = Object.values(results).find((result) => result.id === data.discoveryId);
        if (!selected || selected.address !== address) {
          throw new Error('The selected hub has moved. Select it again or enter its current IP address manually.');
        }
        discoveryId = selected.id;
      }

      const client = new WiserClient({
        host: address,
        secret,
      });

      try {
        this.log('Verifying connection to', address);
        const domain = await client.verifyConnectionWithDomain();
        if (domain === null) {
          this.log('Verify failed: could not fetch domain or unexpected BrandName');
          throw new Error('Could not connect to the Wiser hub. Check the IP address and secret.');
        }
        chipId = domain.System?.ChipId != null ? String(domain.System.ChipId) : null;
        this.log('Verify success');
        return true;
      } finally {
        await client.dispose();
      }
    });

    session.setHandler('list_devices', async (): Promise<HubDevice[]> => {
      this.log('list_devices called for address:', address);
      const client = new WiserClient({
        host: address,
        secret,
      });
      try {
        const domain = await client.getDomain();
        if (domain.System?.BrandName !== 'WiserHeat') throw new Error('The selected address is not a Wiser HeatHub.');
        const id = domain.System?.ChipId != null ? String(domain.System.ChipId) : address;
        if (chipId !== null && id !== chipId) throw new Error('The selected hub changed during pairing. Try again.');
        if (discoveryId) {
          const selected = Object.values(this.getDiscoveryStrategy().getDiscoveryResults())
            .find((result) => result.id === discoveryId);
          if (!selected || selected.address !== address) {
            throw new Error('The selected hub moved during pairing. Select it again.');
          }
        }
        return [
          {
            name: `Wiser HeatHub (${address})`,
            data: { id: String(id) },
            store: {
              address,
              secret,
              ...(discoveryId && chipId ? { discoveryId } : {}),
            },
            settings: { pollInterval: 30, useHttps: false },
          },
        ];
      } finally {
        await client.dispose();
      }
    });
  }
}

module.exports = HubDriver;
