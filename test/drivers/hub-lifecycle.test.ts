/* eslint-disable max-classes-per-file */
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { WiserClient } from '../../lib/wiser-client';
import { WiserHub } from '../../lib/wiser-hub';
import WiserHubManager from '../../lib/wiser-hub-manager';
import * as HubDeviceModule from '../../drivers/hub/device';
import * as RoomDeviceModule from '../../drivers/room/device';
import * as HotWaterDeviceModule from '../../drivers/hotwater/device';
import type { WiserDomain } from '../../lib/wiser-types';

vi.mock('homey', () => ({
  default: {
    Device: class {},
    Driver: class {},
    App: class {},
  },
}));

type TestDevice = Record<string, unknown> & {
  onInit: () => Promise<void>;
  onUninit: () => Promise<void>;
  onDeleted: () => Promise<void>;
  onSettings: (event: { oldSettings: Record<string, unknown>; newSettings: Record<string, unknown>; changedKeys: string[] }) => Promise<void>;
  capabilityValues: ReturnType<typeof vi.fn>;
  capabilityListeners: Map<string, (value: unknown) => Promise<void>>;
  unavailable: ReturnType<typeof vi.fn>;
  available: ReturnType<typeof vi.fn>;
};

const HubDevice = ((HubDeviceModule as { default?: unknown }).default ?? HubDeviceModule) as new () => TestDevice;
const RoomDevice = ((RoomDeviceModule as { default?: unknown }).default ?? RoomDeviceModule) as new () => TestDevice;
const HotWaterDevice = ((HotWaterDeviceModule as { default?: unknown }).default ?? HotWaterDeviceModule) as new () => TestDevice;

const domain: WiserDomain = {
  System: { BrandName: 'WiserHeat', AwayMode: false },
  Room: [{
    id: 1, Name: 'Kitchen', Mode: 'Auto', CalculatedTemperature: 205, CurrentSetPoint: 210,
  }],
  HotWater: [{ id: 1, Mode: 'Auto', WaterHeatingState: 'Off' }],
};

function makeDevice(Cls: new () => TestDevice, manager: WiserHubManager): TestDevice {
  const device = new Cls();
  const store: Record<string, unknown> = {
    hubId: 'hub-1', roomId: 1, hotWaterId: 1, address: '192.0.2.1', secret: 'test-secret', useHttps: false,
  };
  const settings = { pollInterval: 30, useHttps: false };
  device.homey = { app: { hubManager: manager } };
  device.getData = () => ({ id: 'hub-1' });
  device.getName = () => 'Test device';
  device.getStoreValue = (key: string) => store[key];
  device.getSettings = () => settings;
  device.hasCapability = () => true;
  device.log = vi.fn();
  device.error = vi.fn();
  device.capabilityValues = vi.fn().mockResolvedValue(undefined);
  device.capabilityListeners = new Map();
  device.setCapabilityValue = device.capabilityValues;
  device.registerCapabilityListener = (id: string, listener: (value: unknown) => Promise<void>) => {
    device.capabilityListeners.set(id, listener);
  };
  device.setSettings = vi.fn().mockResolvedValue(undefined);
  device.unavailable = vi.fn().mockResolvedValue(undefined);
  device.available = vi.fn().mockResolvedValue(undefined);
  device.setUnavailable = device.unavailable;
  device.setAvailable = device.available;
  device.removeCapability = vi.fn().mockResolvedValue(undefined);
  device.addCapability = vi.fn().mockResolvedValue(undefined);
  return device;
}

describe('shared hub device lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(WiserClient.prototype, 'getDomain').mockResolvedValue(domain);
    vi.spyOn(WiserClient.prototype, 'getSchedules').mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('connects children that initialize before the parent without creating a hub', async () => {
    const manager = new WiserHubManager();
    const room = makeDevice(RoomDevice, manager);
    const hotWater = makeDevice(HotWaterDevice, manager);
    await room.onInit();
    await hotWater.onInit();

    expect(manager.has('hub-1')).toBe(false);
    expect(room.unavailable).toHaveBeenCalledOnce();
    expect(hotWater.unavailable).toHaveBeenCalledOnce();

    const parent = makeDevice(HubDevice, manager);
    await parent.onInit();
    await vi.advanceTimersByTimeAsync(0);

    expect(room.capabilityValues).toHaveBeenCalledWith('measure_temperature', 20.5);
    expect(hotWater.capabilityValues).toHaveBeenCalledWith('wiser_hotwater_state', false);
    expect(room.available).toHaveBeenCalled();
    expect(hotWater.available).toHaveBeenCalled();
    expect(manager.get('hub-1')?.isRunning()).toBe(true);

    await room.onDeleted();
    await hotWater.onDeleted();
    expect(manager.get('hub-1')?.isRunning()).toBe(true);
    await parent.onDeleted();
  });

  it('uses proposed settings and keeps the same hub and subscribers', async () => {
    const manager = new WiserHubManager();
    const parent = makeDevice(HubDevice, manager);
    const room = makeDevice(RoomDevice, manager);
    const hotWater = makeDevice(HotWaterDevice, manager);
    await parent.onInit();
    await room.onInit();
    await hotWater.onInit();
    await vi.advanceTimersByTimeAsync(0);

    const originalHub = manager.get('hub-1');
    const listenerCount = parent.capabilityListeners.size;
    room.capabilityValues.mockClear();
    hotWater.capabilityValues.mockClear();
    await parent.onSettings({
      oldSettings: { pollInterval: 30, useHttps: false },
      newSettings: { pollInterval: 60, useHttps: true },
      changedKeys: ['pollInterval', 'useHttps'],
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(manager.get('hub-1')).toBe(originalHub);
    expect((originalHub as unknown as { intervalMs: number }).intervalMs).toBe(60000);
    expect((originalHub?.getClient() as unknown as { useHttps: boolean }).useHttps).toBe(true);
    expect(parent.capabilityListeners.size).toBe(listenerCount);
    expect(room.capabilityValues).toHaveBeenCalledWith('measure_temperature', 20.5);
    expect(hotWater.capabilityValues).toHaveBeenCalledWith('wiser_hotwater_state', false);

    await room.onUninit();
    await hotWater.onUninit();
    await parent.onUninit();
  });

  it('keeps the replacement hub alive when a previous parent shuts down', async () => {
    const manager = new WiserHubManager();
    const oldParent = makeDevice(HubDevice, manager);
    await oldParent.onInit();
    const room = makeDevice(RoomDevice, manager);
    await room.onInit();
    const oldHub = manager.get('hub-1');
    const replacement = makeDevice(HubDevice, manager);
    await replacement.onInit();
    const newHub = manager.get('hub-1');

    expect(newHub).not.toBe(oldHub);
    await oldParent.onUninit();
    expect(manager.get('hub-1')).toBe(newHub);
    expect(newHub?.isRunning()).toBe(true);

    const writeSetpoint = vi.spyOn(WiserClient.prototype, 'setRoomSetpoint').mockResolvedValue(undefined);
    await room.capabilityListeners.get('target_temperature')?.(21);
    expect(writeSetpoint).toHaveBeenCalledWith(1, 21);
    expect(writeSetpoint.mock.contexts[0]).toBe(newHub?.getClient());

    await room.onDeleted();
    expect(manager.get('hub-1')).toBe(newHub);
    await replacement.onDeleted();
  });

  it('recovers room readings and controls after the initial poll fails', async () => {
    vi.spyOn(WiserClient.prototype, 'getDomain').mockRejectedValueOnce(new Error('offline'));
    const manager = new WiserHubManager();
    const client = new WiserClient({ host: '192.0.2.1', secret: 'test-secret' });
    const hub = new WiserHub({ client });
    manager.register('hub-1', hub);
    const room = makeDevice(RoomDevice, manager);

    await expect(room.onInit()).resolves.toBeUndefined();
    expect(room.unavailable).toHaveBeenCalledWith('Could not connect to the Wiser HeatHub.');
    expect(room.available).not.toHaveBeenCalled();
    expect(room.capabilityListeners.has('target_temperature')).toBe(true);
    expect(room.capabilityListeners.has('wiser_room_mode')).toBe(true);

    await hub.poll();
    expect(room.capabilityValues).toHaveBeenCalledWith('measure_temperature', 20.5);
    expect(room.available).toHaveBeenCalled();

    const setpoint = vi.spyOn(WiserClient.prototype, 'setRoomSetpoint').mockResolvedValue(undefined);
    const mode = vi.spyOn(WiserClient.prototype, 'setRoomMode').mockResolvedValue(undefined);
    await room.capabilityListeners.get('target_temperature')?.(22);
    await room.capabilityListeners.get('wiser_room_mode')?.('manual');
    expect(setpoint).toHaveBeenCalledWith(1, 22);
    expect(mode).toHaveBeenCalledWith(1, 'manual');
    await room.onUninit();
    manager.unregister('hub-1', hub);
  });

  it('recovers hot water readings and controls after the initial poll fails', async () => {
    vi.spyOn(WiserClient.prototype, 'getDomain').mockRejectedValueOnce(new Error('offline'));
    const manager = new WiserHubManager();
    const client = new WiserClient({ host: '192.0.2.1', secret: 'test-secret' });
    const hub = new WiserHub({ client });
    manager.register('hub-1', hub);
    const hotWater = makeDevice(HotWaterDevice, manager);

    await expect(hotWater.onInit()).resolves.toBeUndefined();
    expect(hotWater.unavailable).toHaveBeenCalledWith('Could not connect to the Wiser HeatHub.');
    expect(hotWater.available).not.toHaveBeenCalled();
    expect(hotWater.capabilityListeners.has('wiser_hotwater_mode')).toBe(true);
    expect(hotWater.capabilityListeners.has('wiser_hotwater_boost_30')).toBe(true);
    expect(hotWater.capabilityListeners.has('wiser_hotwater_boost_cancel')).toBe(true);

    await hub.poll();
    expect(hotWater.capabilityValues).toHaveBeenCalledWith('wiser_hotwater_state', false);
    expect(hotWater.available).toHaveBeenCalled();

    const mode = vi.spyOn(WiserClient.prototype, 'setHotWaterMode').mockResolvedValue(undefined);
    const boost = vi.spyOn(WiserClient.prototype, 'setHotWaterOverride').mockResolvedValue(undefined);
    const cancel = vi.spyOn(WiserClient.prototype, 'cancelHotWaterOverride').mockResolvedValue(undefined);
    await hotWater.capabilityListeners.get('wiser_hotwater_mode')?.('on');
    await hotWater.capabilityListeners.get('wiser_hotwater_boost_30')?.(undefined);
    await hotWater.capabilityListeners.get('wiser_hotwater_boost_cancel')?.(undefined);
    expect(mode).toHaveBeenCalledWith(1, 'on');
    expect(boost).toHaveBeenCalledWith(1, 30);
    expect(cancel).toHaveBeenCalledWith(1);
    await hotWater.onUninit();
    manager.unregister('hub-1', hub);
  });
});
