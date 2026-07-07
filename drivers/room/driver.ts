import Homey from 'homey';
import WiserHubManager from '../../lib/wiser-hub-manager';

interface HubApp extends Homey.App {
  hubManager: WiserHubManager;
}

interface RoomPairDevice {
  name: string;
  data: { id: string };
  store: {
    hubId: string;
    roomId: number;
    address: string;
    secret: string;
    useHttps: boolean;
  };
}

class RoomDriver extends Homey.Driver {
  async onInit(): Promise<void> {
    this.homey.flow.getActionCard('boost_room').registerRunListener(async (args: { device: Homey.Device; temperature: number; duration: number }) => {
      const roomId = args.device.getStoreValue('roomId') as number;
      const hubId = args.device.getStoreValue('hubId') as string;
      const manager = (this.homey.app as HubApp).hubManager;
      const hub = manager.get(hubId);
      if (!hub) {
        throw new Error('Hub not available');
      }
      this.log('Boost room', roomId, 'target', args.temperature, 'duration', args.duration);
      await hub.getClient().setRoomSetpointForDuration(roomId, args.temperature, args.duration);
      await hub.poll();
    });
  }

  async onPairListDevices(): Promise<RoomPairDevice[]> {
    const hubDriver = this.homey.drivers.getDriver('hub');
    const hubDevices = hubDriver.getDevices();
    const result: RoomPairDevice[] = [];

    for (const hubDevice of hubDevices) {
      const hubId = hubDevice.getData().id as string;
      const manager = (this.homey.app as HubApp).hubManager;
      const hub = manager.get(hubId);
      let domain = hub?.getDomain();
      if (!domain && hub) {
        domain = await hub.poll();
      }
      if (!domain) {
        continue;
      }

      const address = hubDevice.getStoreValue('address') as string;
      const secret = hubDevice.getStoreValue('secret') as string;
      const useHttps = Boolean(hubDevice.getSetting('useHttps'));
      if (!address || !secret) {
        continue;
      }

      for (const room of domain.Room ?? []) {
        result.push({
          name: room.Name ?? `Room ${room.id}`,
          data: { id: `room-${hubId}-${room.id}` },
          store: {
            hubId,
            roomId: room.id,
            address,
            secret,
            useHttps,
          },
        });
      }
    }

    return result;
  }
}

module.exports = RoomDriver;
