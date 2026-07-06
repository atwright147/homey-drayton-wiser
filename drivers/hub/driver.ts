import Homey from 'homey';
import { WiserClient } from '../../lib/wiser-client';

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
        retries: 1,
        retryDelayMs: 0,
        timeoutMs: 4000,
      });

      this.log('Verifying connection to', address);
      const ok = await client.verifyConnection();
      this.log('Verify result:', ok);
      return ok;
    });

    session.setHandler('list_devices', async (): Promise<HubDevice[]> => {
      this.log('list_devices called for address:', address);
      const client = new WiserClient({
        host: address,
        secret,
        retries: 1,
        retryDelayMs: 0,
        timeoutMs: 4000,
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
