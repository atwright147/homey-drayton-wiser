/* eslint-disable max-classes-per-file, node/no-unsupported-features/es-syntax */
import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import type { WiserClient } from '../../lib/wiser-client';
import * as HotWaterDeviceModule from '../../drivers/hotwater/device';

const HotWaterDevice = ((HotWaterDeviceModule as { default?: unknown }).default ?? HotWaterDeviceModule) as new () => Record<string, unknown>;

vi.mock('homey', () => ({
  default: {
    Device: class {},
    Driver: class {},
    App: class {},
  },
}));

const registerCapabilityListener = vi.fn();
const addCapability = vi.fn().mockResolvedValue(undefined);
const removeCapability = vi.fn().mockResolvedValue(undefined);
const hasCapability = vi.fn<(capability: string) => boolean>(() => true);
const setCapabilityValue = vi.fn().mockResolvedValue(undefined);
const setSettings = vi.fn().mockResolvedValue(undefined);
const setAvailable = vi.fn().mockResolvedValue(undefined);
const setUnavailable = vi.fn().mockResolvedValue(undefined);
const poll = vi.fn().mockResolvedValue(undefined);
const getClient = vi.fn();
const register = vi.fn();
const getHub = vi.fn(() => ({ getClient, poll, register }));
const log = vi.fn();
const error = vi.fn();

const mockHomey = {
  app: { hubManager: { get: getHub } },
};

type TestDevice = Record<string, unknown> & {
  onInit: () => Promise<void>;
  hub: { getClient: typeof getClient; poll: typeof poll } | null;
};

function makeDevice(storeOverrides: Record<string, unknown> = {}): TestDevice {
  const store: Record<string, unknown> = {
    hubId: 'hub-1',
    hotWaterId: 2,
    address: '192.168.1.10',
    secret: 'secret',
    useHttps: false,
    ...storeOverrides,
  };
  const device = new HotWaterDevice() as TestDevice;
  device.homey = mockHomey;
  device.getName = () => 'Wiser Hot Water';
  device.getStoreValue = (key: string) => store[key];
  device.hasCapability = hasCapability;
  device.addCapability = addCapability;
  device.removeCapability = removeCapability;
  device.setCapabilityValue = setCapabilityValue;
  device.registerCapabilityListener = registerCapabilityListener;
  device.setSettings = setSettings;
  device.setAvailable = setAvailable;
  device.setUnavailable = setUnavailable;
  device.log = log;
  device.error = error;
  return device;
}

function capabilityListener(capability: string): () => Promise<void> {
  const call = registerCapabilityListener.mock.calls.find(([id]) => id === capability);
  if (!call) {
    throw new Error(`No listener registered for ${capability}`);
  }
  return call[1] as () => Promise<void>;
}

function resetMocks(): void {
  vi.clearAllMocks();
  addCapability.mockResolvedValue(undefined);
  removeCapability.mockResolvedValue(undefined);
  setCapabilityValue.mockResolvedValue(undefined);
  setSettings.mockResolvedValue(undefined);
  setAvailable.mockResolvedValue(undefined);
  setUnavailable.mockResolvedValue(undefined);
  poll.mockResolvedValue(undefined);
  hasCapability.mockReturnValue(true);
  getHub.mockReturnValue({ getClient, poll, register });
  getClient.mockReturnValue(undefined);
}

describe('HotWater device boost controls', () => {
  beforeEach(() => {
    resetMocks();
  });

  it('replaces the old boost capabilities with fixed-duration buttons', async () => {
    hasCapability.mockImplementation((capability: string) => (
      capability === 'wiser_hotwater_boost_duration' || capability === 'wiser_hotwater_boost'
    ));
    const device = makeDevice();

    await device.onInit();

    expect(removeCapability).toHaveBeenCalledWith('wiser_hotwater_boost_duration');
    expect(removeCapability).toHaveBeenCalledWith('wiser_hotwater_boost');
    expect(addCapability).toHaveBeenCalledWith('wiser_hotwater_boost_30');
    expect(addCapability).toHaveBeenCalledWith('wiser_hotwater_boost_60');
    expect(addCapability).toHaveBeenCalledWith('wiser_hotwater_boost_cancel');
  });

  it('continues initialising when a deprecated capability cannot be removed', async () => {
    hasCapability.mockImplementation((capability: string) => (
      capability === 'wiser_hotwater_boost_duration' || capability === 'wiser_hotwater_boost'
    ));
    removeCapability.mockRejectedValueOnce(new Error('Invalid Capability'));
    const device = makeDevice();

    await expect(device.onInit()).resolves.toBeUndefined();

    expect(error).toHaveBeenCalled();
    expect(registerCapabilityListener).toHaveBeenCalledWith('wiser_hotwater_boost_30', expect.any(Function));
  });

  it('boosts for 30 minutes and polls', async () => {
    const setHotWaterOverride = vi.fn().mockResolvedValue(undefined);
    getClient.mockReturnValue({ setHotWaterOverride } as unknown as WiserClient);
    const device = makeDevice();
    await device.onInit();
    poll.mockClear();

    await capabilityListener('wiser_hotwater_boost_30')();

    expect(setHotWaterOverride).toHaveBeenCalledWith(2, 30);
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it('boosts for 60 minutes and polls', async () => {
    const setHotWaterOverride = vi.fn().mockResolvedValue(undefined);
    getClient.mockReturnValue({ setHotWaterOverride } as unknown as WiserClient);
    const device = makeDevice();
    await device.onInit();
    poll.mockClear();

    await capabilityListener('wiser_hotwater_boost_60')();

    expect(setHotWaterOverride).toHaveBeenCalledWith(2, 60);
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it('cancels the boost and polls', async () => {
    const cancelHotWaterOverride = vi.fn().mockResolvedValue(undefined);
    getClient.mockReturnValue({ cancelHotWaterOverride } as unknown as WiserClient);
    const device = makeDevice();
    await device.onInit();
    poll.mockClear();

    await capabilityListener('wiser_hotwater_boost_cancel')();

    expect(cancelHotWaterOverride).toHaveBeenCalledWith(2);
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it('throws when the hub becomes unavailable after setup', async () => {
    const device = makeDevice();
    await device.onInit();
    device.hub = null;

    await expect(capabilityListener('wiser_hotwater_boost_30')()).rejects.toThrow('Hub not available');
    await expect(capabilityListener('wiser_hotwater_boost_60')()).rejects.toThrow('Hub not available');
    await expect(capabilityListener('wiser_hotwater_boost_cancel')()).rejects.toThrow('Hub not available');
  });
});
