/* eslint-disable max-classes-per-file */
import { EventEmitter } from 'node:events';
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { WiserClient } from '../../lib/wiser-client';
import { WiserHub } from '../../lib/wiser-hub';
import { WiserAuthError } from '../../lib/wiser-errors';
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
  device.driver = {
    getDiscoveryStrategy: () => Object.assign(new EventEmitter(), { getDiscoveryResults: () => ({}) }),
  };
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

  it('upgrades a paired hub and tracks Home/Away and the configured Away target', async () => {
    const getDomain = vi.spyOn(WiserClient.prototype, 'getDomain').mockResolvedValue({
      ...domain,
      System: { BrandName: 'WiserHeat', AwayModeSetPointLimit: 160 },
    });
    const manager = new WiserHubManager();
    const parent = makeDevice(HubDevice, manager);
    const capabilities = new Set(['wiser_away_mode', 'wiser_comfort_mode', 'wiser_eco_mode']);
    parent.hasCapability = (id: string) => capabilities.has(id);
    parent.addCapability = vi.fn(async (id: string) => {
      capabilities.add(id);
    });

    await parent.onInit();
    await vi.advanceTimersByTimeAsync(0);
    expect(parent.addCapability).toHaveBeenCalledWith('wiser_home_away_mode');
    expect(parent.addCapability).toHaveBeenCalledWith('measure_away_temperature');
    expect(parent.removeCapability).not.toHaveBeenCalled();
    expect(parent.capabilityValues).toHaveBeenCalledWith('wiser_home_away_mode', 'home');
    expect(parent.capabilityValues).toHaveBeenCalledWith('measure_away_temperature', 16);
    expect(parent.capabilityValues).toHaveBeenCalledWith('wiser_away_mode', false);

    parent.capabilityValues.mockClear();
    getDomain.mockResolvedValue({
      ...domain,
      System: { ...domain.System, OverrideType: 'Away', AwayModeSetPointLimit: 175 },
    });
    await manager.get('hub-1')?.poll();
    expect(parent.capabilityValues).toHaveBeenCalledWith('wiser_away_mode', true);
    expect(parent.capabilityValues).toHaveBeenCalledWith('wiser_home_away_mode', 'away');
    expect(parent.capabilityValues).toHaveBeenCalledWith('measure_away_temperature', 17.5);

    parent.capabilityValues.mockClear();
    getDomain.mockResolvedValue({ ...domain, System: { OverrideType: 'Other', AwayModeSetPointLimit: -200 } });
    await manager.get('hub-1')?.poll();
    expect(parent.capabilityValues).toHaveBeenCalledWith('wiser_home_away_mode', null);
    expect(parent.capabilityValues).toHaveBeenCalledWith('measure_away_temperature', null);
    expect(parent.capabilityValues).toHaveBeenCalledWith('wiser_away_mode', null);
    await parent.onUninit();
  });

  it('keeps the legacy Away control and the new picker synchronized through polls', async () => {
    const getDomain = vi.spyOn(WiserClient.prototype, 'getDomain').mockResolvedValue(domain);
    const setAwayMode = vi.spyOn(WiserClient.prototype, 'setAwayMode').mockResolvedValue(undefined);
    const manager = new WiserHubManager();
    const parent = makeDevice(HubDevice, manager);
    await parent.onInit();
    await vi.advanceTimersByTimeAsync(0);

    getDomain.mockResolvedValue({ ...domain, System: { AwayMode: true } });
    await parent.capabilityListeners.get('wiser_home_away_mode')?.('away');
    expect(setAwayMode).toHaveBeenLastCalledWith(true);
    expect(parent.capabilityValues).toHaveBeenCalledWith('wiser_home_away_mode', 'away');
    expect(parent.capabilityValues).toHaveBeenCalledWith('wiser_away_mode', true);

    getDomain.mockResolvedValue({ ...domain, System: { OverrideType: 'None' } });
    await parent.capabilityListeners.get('wiser_home_away_mode')?.('home');
    expect(setAwayMode).toHaveBeenLastCalledWith(false);
    expect(parent.capabilityValues).toHaveBeenCalledWith('wiser_home_away_mode', 'home');

    getDomain.mockResolvedValue({ ...domain, System: { OverrideType: 'Away' } });
    await parent.capabilityListeners.get('wiser_away_mode')?.(true);
    expect(setAwayMode).toHaveBeenLastCalledWith(true);
    expect(setAwayMode).toHaveBeenCalledTimes(3);
    await expect(parent.capabilityListeners.get('wiser_home_away_mode')?.('invalid')).rejects.toThrow('Invalid Home/Away mode');
    expect(setAwayMode).toHaveBeenCalledTimes(3);
    await parent.onUninit();
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

  it('marks the hub and children unavailable after sustained failures and restores them on recovery', async () => {
    const manager = new WiserHubManager();
    const parent = makeDevice(HubDevice, manager);
    const room = makeDevice(RoomDevice, manager);
    const hotWater = makeDevice(HotWaterDevice, manager);
    await parent.onInit();
    await room.onInit();
    await hotWater.onInit();
    await vi.advanceTimersByTimeAsync(0);

    const hub = manager.get('hub-1');
    const getDomain = vi.spyOn(WiserClient.prototype, 'getDomain').mockRejectedValue(new Error('offline'));
    for (let i = 0; i < 3; i++) {
      await expect(hub?.poll()).rejects.toThrow('offline');
    }

    for (const device of [parent, room, hotWater]) {
      expect(device.unavailable).toHaveBeenLastCalledWith('Could not connect to the Wiser HeatHub.');
    }
    expect(hub?.getDomain()).toBeNull();

    const recoveryCounts = [parent, room, hotWater].map((device) => device.available.mock.calls.length);
    getDomain.mockResolvedValue(domain);
    await hub?.poll();
    [parent, room, hotWater].forEach((device, index) => {
      expect(device.available.mock.calls.length).toBeGreaterThan(recoveryCounts[index]);
    });
    expect(hub?.getHealth().available).toBe(true);
    await room.onUninit();
    await hotWater.onUninit();
    await parent.onUninit();
  });

  it('reports authentication failure immediately and parent removal to children', async () => {
    const manager = new WiserHubManager();
    const parent = makeDevice(HubDevice, manager);
    const room = makeDevice(RoomDevice, manager);
    const hotWater = makeDevice(HotWaterDevice, manager);
    await parent.onInit();
    await room.onInit();
    await hotWater.onInit();
    await vi.advanceTimersByTimeAsync(0);

    vi.spyOn(WiserClient.prototype, 'getDomain').mockRejectedValue(new WiserAuthError('bad secret'));
    await expect(manager.get('hub-1')?.poll()).rejects.toThrow('bad secret');
    for (const device of [parent, room, hotWater]) {
      expect(device.unavailable).toHaveBeenLastCalledWith('Wiser HeatHub authentication failed. Check the secret.');
    }

    await parent.onDeleted();
    await vi.advanceTimersByTimeAsync(0);
    expect(room.unavailable).toHaveBeenLastCalledWith('The parent Wiser HeatHub is not available.');
    expect(hotWater.unavailable).toHaveBeenLastCalledWith('The parent Wiser HeatHub is not available.');
    await room.onUninit();
    await hotWater.onUninit();
  });

  it('does not restore a child from a poll stopped during a capability update', async () => {
    for (const [Cls, delayedCapability] of [
      [RoomDevice, 'measure_temperature'],
      [HotWaterDevice, 'wiser_hotwater_state'],
    ] as const) {
      const manager = new WiserHubManager();
      const client = new WiserClient({ host: '192.0.2.1', secret: 'test-secret' });
      const hub = new WiserHub({ client });
      manager.register('hub-1', hub);
      const child = makeDevice(Cls, manager);
      await child.onInit();
      expect(child.available).toHaveBeenCalledTimes(1);

      let releaseUpdate: () => void = () => {};
      let enteredUpdate: () => void = () => {};
      const updatePending = new Promise<void>((resolve) => {
        releaseUpdate = resolve;
      });
      const updateEntered = new Promise<void>((resolve) => {
        enteredUpdate = resolve;
      });
      child.capabilityValues.mockImplementation((id: string) => {
        if (id === delayedCapability) {
          enteredUpdate();
          return updatePending;
        }
        return Promise.resolve();
      });

      const pending = hub.poll();
      await updateEntered;
      manager.unregister('hub-1', hub);
      releaseUpdate();
      await expect(pending).resolves.toBeNull();
      expect(child.available).toHaveBeenCalledTimes(1);
      expect(child.unavailable).toHaveBeenLastCalledWith('The parent Wiser HeatHub is not available.');
      await child.onUninit();
    }
  });

  it('reapplies unavailability if shutdown occurs during setAvailable', async () => {
    const manager = new WiserHubManager();
    const client = new WiserClient({ host: '192.0.2.1', secret: 'test-secret' });
    const hub = new WiserHub({ client });
    manager.register('hub-1', hub);
    const room = makeDevice(RoomDevice, manager);

    let releaseAvailable: () => void = () => {};
    let enteredAvailable: () => void = () => {};
    const availablePending = new Promise<void>((resolve) => {
      releaseAvailable = resolve;
    });
    const availableEntered = new Promise<void>((resolve) => {
      enteredAvailable = resolve;
    });
    room.available.mockImplementation(() => {
      enteredAvailable();
      return availablePending;
    });

    const pending = room.onInit();
    await availableEntered;
    manager.unregister('hub-1', hub);
    const unavailableBeforeCompletion = room.unavailable.mock.calls.length;
    releaseAvailable();
    await expect(pending).resolves.toBeUndefined();
    expect(room.unavailable.mock.calls.length).toBeGreaterThan(unavailableBeforeCompletion);
    expect(room.unavailable).toHaveBeenLastCalledWith('The parent Wiser HeatHub is not available.');
    await room.onUninit();
  });

  it('restores children after a delayed old-hub unavailable update and a fresh replacement poll', async () => {
    for (const [Cls, updatedCapability] of [
      [RoomDevice, 'wiser_room_mode'],
      [HotWaterDevice, 'wiser_hotwater_next_event'],
    ] as const) {
      const manager = new WiserHubManager();
      const oldHub = new WiserHub({ client: new WiserClient({ host: '192.0.2.1', secret: 'test-secret' }) });
      manager.register('hub-1', oldHub);
      const child = makeDevice(Cls, manager);
      await child.onInit();
      let visibleAvailable = true;

      let releaseUnavailable: () => void = () => {};
      let enteredUnavailable: () => void = () => {};
      const unavailablePending = new Promise<void>((resolve) => {
        releaseUnavailable = resolve;
      });
      const unavailableEntered = new Promise<void>((resolve) => {
        enteredUnavailable = resolve;
      });
      child.unavailable.mockImplementation(async () => {
        enteredUnavailable();
        await unavailablePending;
        visibleAvailable = false;
      });

      let freshDataUpdated: () => void = () => {};
      const freshDataEntered = new Promise<void>((resolve) => {
        freshDataUpdated = resolve;
      });
      child.capabilityValues.mockImplementation((id: string) => {
        if (id === updatedCapability) freshDataUpdated();
        return Promise.resolve();
      });
      child.available.mockImplementation(async () => {
        visibleAvailable = true;
      });

      manager.unregister('hub-1', oldHub);
      await unavailableEntered;
      const newHub = new WiserHub({ client: new WiserClient({ host: '192.0.2.2', secret: 'test-secret' }) });
      manager.register('hub-1', newHub);
      const freshPoll = newHub.poll();
      await freshDataEntered;
      await Promise.resolve();
      await Promise.resolve();
      releaseUnavailable();
      await freshPoll;

      expect(visibleAvailable).toBe(true);
      expect(child.available).toHaveBeenCalledTimes(2);
      await child.onUninit();
      manager.unregister('hub-1', newHub);
    }
  });

  it('uses the current Homey timezone for each hot water poll', async () => {
    vi.setSystemTime(new Date('2026-07-06T06:45:00Z'));
    const scheduledDomain: WiserDomain = {
      ...domain,
      HotWater: [{
        id: 1, Mode: 'Auto', WaterHeatingState: 'Off', ScheduleId: 10,
      }],
      Schedule: [{ id: 10, Monday: [630, -730, 1800] }],
    };
    vi.spyOn(WiserClient.prototype, 'getDomain').mockResolvedValue(scheduledDomain);
    const manager = new WiserHubManager();
    const hub = new WiserHub({ client: new WiserClient({ host: '192.0.2.1', secret: 'test-secret' }) });
    manager.register('hub-1', hub);
    const hotWater = makeDevice(HotWaterDevice, manager);
    const getTimezone = vi.fn().mockResolvedValueOnce('Europe/London').mockResolvedValue('UTC');
    (hotWater.homey as Record<string, unknown>).clock = { getTimezone };

    await hotWater.onInit();
    expect(hotWater.capabilityValues).toHaveBeenCalledWith('wiser_hotwater_next_event', 'Today 18:00 (On)');
    await hub.poll();
    expect(hotWater.capabilityValues).toHaveBeenLastCalledWith('wiser_hotwater_next_event', 'Today 07:30 (Off)');
    expect(getTimezone).toHaveBeenCalledTimes(2);
    await hotWater.onUninit();
    manager.unregister('hub-1', hub);
  });

  it('shows a timezone error and retries the Homey clock on a later poll', async () => {
    vi.setSystemTime(new Date('2026-07-06T06:45:00Z'));
    const scheduledDomain: WiserDomain = {
      ...domain,
      HotWater: [{
        id: 1, Mode: 'Auto', WaterHeatingState: 'Off', ScheduleId: 10,
      }],
      Schedule: [{ id: 10, Monday: [630, -730, 1800] }],
    };
    vi.spyOn(WiserClient.prototype, 'getDomain').mockResolvedValue(scheduledDomain);
    const manager = new WiserHubManager();
    const hub = new WiserHub({ client: new WiserClient({ host: '192.0.2.1', secret: 'test-secret' }) });
    manager.register('hub-1', hub);
    const hotWater = makeDevice(HotWaterDevice, manager);
    const getTimezone = vi.fn().mockRejectedValueOnce(new Error('clock offline')).mockResolvedValue('Europe/London');
    (hotWater.homey as Record<string, unknown>).clock = { getTimezone };

    await hotWater.onInit();
    expect(hotWater.capabilityValues).toHaveBeenCalledWith('wiser_hotwater_next_event', 'Timezone unavailable');
    expect(hotWater.error).toHaveBeenCalled();
    await hub.poll();
    expect(hotWater.capabilityValues).toHaveBeenCalledWith('wiser_hotwater_next_event', 'Today 18:00 (On)');
    expect(getTimezone).toHaveBeenCalledTimes(2);
    await hotWater.onUninit();
    manager.unregister('hub-1', hub);
  });
});

describe('heating and Home/Away events', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(WiserClient.prototype, 'getDomain').mockResolvedValue(domain);
    vi.spyOn(WiserClient.prototype, 'getSchedules').mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('migrates demand and fires room transitions after the initial healthy reading', async () => {
    vi.mocked(WiserClient.prototype.getDomain).mockResolvedValue({
      ...domain, Room: [{ ...domain.Room![0], PercentageDemand: 0, ControlOutputState: 'Off' }],
    });
    const manager = new WiserHubManager();
    const parent = makeDevice(HubDevice, manager);
    const room = makeDevice(RoomDevice, manager);
    const trigger = vi.fn().mockResolvedValue(undefined);
    room.homey = { app: { hubManager: manager }, flow: { getDeviceTriggerCard: vi.fn(() => ({ trigger })) } };
    const caps = new Set(['measure_temperature', 'target_temperature', 'measure_humidity', 'wiser_room_mode']);
    room.hasCapability = (id: string) => caps.has(id);
    room.addCapability = vi.fn(async (id: string) => {
      caps.add(id);
    });
    await parent.onInit();
    await room.onInit();
    await vi.advanceTimersByTimeAsync(0);
    expect(room.addCapability).toHaveBeenCalledWith('wiser_room_demand');
    expect(room.capabilityValues).toHaveBeenCalledWith('wiser_room_demand', 0);
    expect(trigger).not.toHaveBeenCalled();
    vi.mocked(WiserClient.prototype.getDomain).mockResolvedValue({ ...domain, Room: [{ ...domain.Room![0], PercentageDemand: 55, ControlOutputState: 'On' }] });
    await manager.get('hub-1')?.poll();
    expect(room.capabilityValues).toHaveBeenCalledWith('wiser_room_demand', 55);
    expect(room.homey.flow.getDeviceTriggerCard).toHaveBeenCalledWith('room_heating_started');
    expect(trigger).toHaveBeenCalledOnce();
    await manager.get('hub-1')?.poll();
    expect(trigger).toHaveBeenCalledOnce();
    vi.mocked(WiserClient.prototype.getDomain).mockResolvedValue({ ...domain, Room: [{ ...domain.Room![0], PercentageDemand: 0, ControlOutputState: 'Off' }] });
    await manager.get('hub-1')?.poll();
    expect(room.homey.flow.getDeviceTriggerCard).toHaveBeenCalledWith('room_heating_stopped');
    expect(trigger).toHaveBeenCalledTimes(2);
    await room.onDeleted();
    await parent.onDeleted();
  });

  it('fires Home/Away changes with the new mode, without a startup event', async () => {
    const manager = new WiserHubManager();
    const parent = makeDevice(HubDevice, manager);
    const trigger = vi.fn().mockResolvedValue(undefined);
    parent.homey = { app: { hubManager: manager }, flow: { getDeviceTriggerCard: vi.fn(() => ({ trigger })) } };
    await parent.onInit();
    await vi.advanceTimersByTimeAsync(0);
    expect(trigger).not.toHaveBeenCalled();
    vi.mocked(WiserClient.prototype.getDomain).mockResolvedValue({ ...domain, System: { OverrideType: 'Away' } });
    await manager.get('hub-1')?.poll();
    expect(parent.homey.flow.getDeviceTriggerCard).toHaveBeenCalledWith('home_away_changed');
    expect(trigger).toHaveBeenCalledWith(parent, { mode: 'away' });
    await manager.get('hub-1')?.poll();
    expect(trigger).toHaveBeenCalledOnce();
    vi.mocked(WiserClient.prototype.getDomain).mockResolvedValue({ ...domain, System: { OverrideType: 'None' } });
    await manager.get('hub-1')?.poll();
    expect(trigger).toHaveBeenCalledWith(parent, { mode: 'home' });
    await parent.onDeleted();
  });
});
