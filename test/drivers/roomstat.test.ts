import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { WiserClient } from '../../lib/wiser-client';
import { WiserHub } from '../../lib/wiser-hub';
import WiserHubManager from '../../lib/wiser-hub-manager';
import { WiserAuthError } from '../../lib/wiser-errors';
import type { WiserDomain } from '../../lib/wiser-types';
import * as DeviceModule from '../../drivers/roomstat/device';
import * as DriverModule from '../../drivers/roomstat/driver';

vi.mock('homey', () => {
  class HomeyBase {}
  return { default: { Device: HomeyBase, Driver: HomeyBase } };
});

type TestDevice = Record<string, unknown> & {
  onInit: () => Promise<void>;
  onUninit: () => Promise<void>;
  onDeleted: () => Promise<void>;
  setCapabilityValue: ReturnType<typeof vi.fn>;
  setAvailable: ReturnType<typeof vi.fn>;
  setUnavailable: ReturnType<typeof vi.fn>;
};
type TestDriver = Record<string, unknown> & { onPairListDevices: () => Promise<unknown[]> };
const Device = ((DeviceModule as { default?: unknown }).default ?? DeviceModule) as new () => TestDevice;
const Driver = ((DriverModule as { default?: unknown }).default ?? DriverModule) as new () => TestDriver;
const domain: WiserDomain = {
  Device: [{
    id: 42, ProductType: 'RoomStat', BatteryVoltage: 22, DisplayedSignalStrength: 'Good',
  }],
  RoomStat: [{ id: 42, MeasuredTemperature: 215, MeasuredHumidity: 48 }],
  Room: [{ id: 9, Name: 'Office', RoomStatId: 42 }],
};
const hubs: WiserHub[] = [];

function makeHub(manager: WiserHubManager, id = 'hub-1'): WiserHub {
  const hub = new WiserHub({ client: new WiserClient({ host: '192.0.2.1', secret: 'test-secret' }) });
  manager.register(id, hub);
  hubs.push(hub);
  return hub;
}

function makeDevice(manager: WiserHubManager, id = 'device-1'): TestDevice {
  const device = new Device();
  device.homey = { app: { hubManager: manager } };
  device.getData = () => ({ id });
  device.getStoreValue = (key: string) => ({ hubId: 'hub-1', roomStatId: 42 })[key as 'hubId' | 'roomStatId'];
  device.setCapabilityValue = vi.fn().mockResolvedValue(undefined);
  device.setAvailable = vi.fn().mockResolvedValue(undefined);
  device.setUnavailable = vi.fn().mockResolvedValue(undefined);
  device.error = vi.fn();
  return device;
}

function makeDriver(manager: WiserHubManager, ids = ['hub-1']): TestDriver {
  const driver = new Driver();
  driver.homey = {
    app: { hubManager: manager },
    drivers: { getDriver: () => ({ getDevices: () => ids.map((id) => ({ getData: () => ({ id }) })) }) },
  };
  driver.error = vi.fn();
  return driver;
}

describe('RoomStat driver and device', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(WiserClient.prototype, 'getDomain').mockResolvedValue(domain);
    vi.spyOn(WiserClient.prototype, 'getSchedules').mockResolvedValue([]);
  });

  afterEach(() => {
    hubs.splice(0).forEach((hub) => hub.dispose());
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('pairs physical RoomStats with hub-scoped IDs, room names and no credential copies', async () => {
    const manager = new WiserHubManager();
    makeHub(manager);
    const driver = makeDriver(manager);
    expect(await driver.onPairListDevices()).toEqual([{
      name: 'Office RoomStat', data: { id: 'roomstat-hub-1-42' }, store: { hubId: 'hub-1', roomStatId: 42 },
    }]);
    await driver.onPairListDevices();
    expect(WiserClient.prototype.getDomain).toHaveBeenCalledOnce();
  });

  it('lists unassigned RoomStats once and ignores non-RoomStat and unmatched records', async () => {
    vi.mocked(WiserClient.prototype.getDomain).mockResolvedValue({
      Device: [{ id: 42, ProductType: 'RoomStat' }, { id: 42, ProductType: 'RoomStat' }, { id: 43, ProductType: 'iTRV' }, { id: 44, ProductType: 'RoomStat' }],
      RoomStat: [{ id: 42 }, { id: 43 }],
    });
    const manager = new WiserHubManager();
    makeHub(manager);
    expect(await makeDriver(manager).onPairListDevices()).toEqual([{
      name: 'RoomStat 42', data: { id: 'roomstat-hub-1-42' }, store: { hubId: 'hub-1', roomStatId: 42 },
    }]);
  });

  it('isolates unavailable hubs and keeps IDs distinct across hubs', async () => {
    const manager = new WiserHubManager();
    makeHub(manager, 'offline');
    makeHub(manager, 'one');
    makeHub(manager, 'two');
    vi.mocked(WiserClient.prototype.getDomain).mockRejectedValueOnce(new Error('offline'));
    const result = await makeDriver(manager, ['missing', 'offline', 'one', 'two']).onPairListDevices();
    expect(result).toMatchObject([{ data: { id: 'roomstat-one-42' } }, { data: { id: 'roomstat-two-42' } }]);
  });

  it('attaches after parent registration, follows replacement, and survives a client change', async () => {
    const manager = new WiserHubManager();
    const device = makeDevice(manager);
    await device.onInit();
    expect(manager.has('hub-1')).toBe(false);
    expect(device.setUnavailable).toHaveBeenCalled();
    const first = makeHub(manager);
    await first.poll();
    expect(device.setCapabilityValue).toHaveBeenCalledWith('measure_temperature', 21.5);
    expect(device.setCapabilityValue).toHaveBeenCalledWith('measure_humidity', 48);
    expect(device.setCapabilityValue).toHaveBeenCalledWith('measure_battery', 50);
    expect(device.setCapabilityValue).toHaveBeenCalledWith('measure_signal', 80);
    expect(device.setAvailable).toHaveBeenCalled();
    const second = makeHub(manager);
    vi.mocked(WiserClient.prototype.getDomain).mockResolvedValue({ ...domain, RoomStat: [{ id: 42, MeasuredTemperature: 230 }] });
    await second.poll();
    expect(device.setCapabilityValue).toHaveBeenCalledWith('measure_temperature', 23);
    second.setClient(new WiserClient({ host: '192.0.2.2', secret: 'replacement' }));
    await second.poll();
    expect(manager.get('hub-1')).toBe(second);
    expect(second.getHealth().available).toBe(true);
    await device.onDeleted();
  });

  it('uses cached readings without extra requests and clears missing measurements on the next poll', async () => {
    const manager = new WiserHubManager();
    const hub = makeHub(manager);
    await hub.poll();
    const device = makeDevice(manager);
    await device.onInit();
    await vi.advanceTimersByTimeAsync(0);
    expect(WiserClient.prototype.getDomain).toHaveBeenCalledOnce();
    expect(device.setAvailable).toHaveBeenCalledOnce();
    vi.mocked(WiserClient.prototype.getDomain).mockResolvedValue({ Device: [{ id: 42, ProductType: 'RoomStat' }], RoomStat: [{ id: 42 }] });
    await hub.poll();
    for (const capability of ['measure_temperature', 'measure_humidity', 'measure_battery', 'measure_signal']) {
      expect(device.setCapabilityValue).toHaveBeenCalledWith(capability, null);
    }
    await device.onUninit();
  });

  it('reflects authentication failure, missing devices and offline devices, then recovers', async () => {
    const manager = new WiserHubManager();
    const hub = makeHub(manager);
    const device = makeDevice(manager);
    await device.onInit();
    vi.mocked(WiserClient.prototype.getDomain).mockRejectedValueOnce(new WiserAuthError('auth'));
    await expect(hub.poll()).rejects.toThrow();
    expect(device.setUnavailable).toHaveBeenLastCalledWith(expect.stringContaining('authentication'));
    vi.mocked(WiserClient.prototype.getDomain).mockResolvedValueOnce({});
    await hub.poll();
    expect(device.setUnavailable).toHaveBeenLastCalledWith(expect.stringContaining('no longer reported'));
    expect(device.setCapabilityValue).toHaveBeenCalledWith('measure_temperature', null);
    vi.mocked(WiserClient.prototype.getDomain).mockResolvedValueOnce({
      ...domain, Device: [{ id: 42, ProductType: 'RoomStat', DisplayedSignalStrength: 'Offline' }],
    });
    await hub.poll();
    expect(device.setUnavailable).toHaveBeenLastCalledWith(expect.stringContaining('offline'));
    expect(device.setCapabilityValue).toHaveBeenCalledWith('measure_signal', 0);
    device.setAvailable.mockClear();
    await hub.poll();
    expect(device.setAvailable).toHaveBeenCalledOnce();
    await device.onDeleted();
  });

  it.each(['onDeleted', 'onUninit'] as const)('unsubscribes on %s without stopping the parent or another RoomStat', async (method) => {
    const manager = new WiserHubManager();
    const hub = makeHub(manager);
    hub.start();
    const first = makeDevice(manager, 'first');
    const second = makeDevice(manager, 'second');
    await first.onInit();
    await second.onInit();
    await vi.advanceTimersByTimeAsync(0);
    await first[method]();
    first.setCapabilityValue.mockClear();
    second.setCapabilityValue.mockClear();
    await hub.poll();
    expect(first.setCapabilityValue).not.toHaveBeenCalled();
    expect(second.setCapabilityValue).toHaveBeenCalled();
    expect(hub.isRunning()).toBe(true);
    await second.onDeleted();
  });

  it.each(['delete', 'replace'])('does not publish further stale readings or availability after %s during a poll', async (action) => {
    const manager = new WiserHubManager();
    const hub = makeHub(manager);
    const device = makeDevice(manager);
    await device.onInit();
    device.setAvailable.mockClear();
    device.setCapabilityValue.mockClear();
    let release: () => void = () => {};
    device.setCapabilityValue.mockImplementationOnce(() => new Promise<void>((resolve) => {
      release = resolve;
    }));
    const pending = hub.poll();
    await vi.advanceTimersByTimeAsync(0);
    if (action === 'delete') await device.onDeleted();
    else makeHub(manager);
    release();
    await pending;
    expect(device.setCapabilityValue).toHaveBeenCalledOnce();
    expect(device.setAvailable).not.toHaveBeenCalled();
    await device.onDeleted();
  });
});
