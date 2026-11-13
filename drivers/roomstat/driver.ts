import Homey from 'homey';
import WiserHubManager from '../../lib/wiser-hub-manager';
import { getRoomStatReadings } from '../../lib/wiser-roomstat';

interface HubApp extends Homey.App {
  hubManager: WiserHubManager;
}

interface RoomStatPairDevice {
  name: string;
  data: { id: string };
  store: { hubId: string; roomStatId: number };
}

class RoomStatDriver extends Homey.Driver {
  async onPairListDevices(): Promise<RoomStatPairDevice[]> {
    const manager = (this.homey.app as HubApp).hubManager;
    const devices: RoomStatPairDevice[] = [];
    for (const parent of this.homey.drivers.getDriver('hub').getDevices()) {
      const hubId = parent.getData().id as string;
      const hub = manager.get(hubId);
      if (!hub) continue;
      try {
        const domain = hub.getDomain() ?? await hub.poll();
        if (!domain || manager.get(hubId) !== hub || hub.getDomain() !== domain) continue;
        const ids = new Set((domain.Device ?? []).filter((device) => device.ProductType === 'RoomStat').map((device) => device.id));
        for (const id of ids) {
          const stat = getRoomStatReadings(domain, id);
          if (!stat) continue;
          devices.push({
            name: stat.name,
            data: { id: `roomstat-${hubId}-${id}` },
            store: { hubId, roomStatId: id },
          });
        }
      } catch {
        this.error('Could not list RoomStats from a paired HeatHub.');
      }
    }
    return devices;
  }
}

module.exports = RoomStatDriver;
