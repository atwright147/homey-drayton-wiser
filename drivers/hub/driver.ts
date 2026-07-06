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
  store: { address: string; secret: string };
  settings: { pollInterval: number; useHttps: boolean };
}

class HubDriver extends Homey.Driver {
  async onInit(): Promise<void> {
    this.log('HubDriver onInit v4 - custom view');
  }

  async onPair(session: Homey.Driver.PairSession): Promise<void> {
    this.log('onPair v4 session started');
    let address = '';
    let secret = '';

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

    session.setHandler('login', async (data: { ip: string; secret: string }): Promise<boolean> => {
      this.log('Login handler called with ip:', data.ip);
      address = data.ip.trim();
      secret = data.secret.trim();

      if (!address || !secret) {
        this.log('Missing address or secret');
        return false;
      }

      const client = new WiserClient({
        host: address,
        secret,
      });

      this.log('Verifying connection to', address);
      const domain = await client.verifyConnectionWithDomain();
      if (domain === null) {
        this.log('Verify failed: could not fetch domain or unexpected BrandName');
        throw new Error('Could not connect to the Wiser hub. Check the IP address and secret.');
      }
      this.log('Verify success');
      return true;
    });

    session.setHandler('list_devices', async (): Promise<HubDevice[]> => {
      this.log('list_devices called for address:', address);
      const client = new WiserClient({
        host: address,
        secret,
      });
      const domain = await client.getDomain();
      const id = domain.System?.ChipId ?? address;
      return [
        {
          name: `Wiser HeatHub (${address})`,
          data: { id: String(id) },
          store: { address, secret },
          settings: { pollInterval: 30, useHttps: false },
        },
      ];
    });
  }
}

module.exports = HubDriver;
