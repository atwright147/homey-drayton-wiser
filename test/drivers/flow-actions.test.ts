/* eslint-disable max-classes-per-file, node/no-unsupported-features/es-syntax */
import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import type { WiserClient } from '../../lib/wiser-client';
import * as RoomDriverModule from '../../drivers/room/driver';
import * as HotWaterDriverModule from '../../drivers/hotwater/driver';

const RoomDriver = ((RoomDriverModule as { default?: unknown }).default ?? RoomDriverModule) as new () => unknown;
const HotWaterDriver = ((HotWaterDriverModule as { default?: unknown }).default ?? HotWaterDriverModule) as new () => unknown;

vi.mock('homey', () => ({
  default: {
    Driver: class {},
    Device: class {},
    App: class {},
  },
}));

const registerRunListener = vi.fn();
const getActionCard = vi.fn(() => ({ registerRunListener }));
const poll = vi.fn();
const getClient = vi.fn();
type MockHub = {
  getClient: typeof getClient;
  poll: typeof poll;
};

const getHub = vi.fn<(hubId: string) => MockHub | null>(() => ({ getClient, poll }));
const mockHomey = {
  flow: { getActionCard },
  app: { hubManager: { get: getHub } },
  log: vi.fn(),
  error: vi.fn(),
};

type FlowDevice = {
  getStoreValue: (key: string) => unknown;
};

function makeDevice(store: Record<string, unknown>): FlowDevice {
  return {
    getStoreValue: (key: string) => store[key],
  };
}

function initRoomDriver(): Record<string, unknown> {
  const driver = new RoomDriver() as unknown as Record<string, unknown>;
  driver.homey = mockHomey;
  driver.log = vi.fn();
  driver.error = vi.fn();
  return driver;
}

function initHotWaterDriver(): Record<string, unknown> {
  const driver = new HotWaterDriver() as unknown as Record<string, unknown>;
  driver.homey = mockHomey;
  driver.log = vi.fn();
  driver.error = vi.fn();
  return driver;
}

function lastRunListener(): (args: Record<string, unknown>) => Promise<void> {
  return registerRunListener.mock.calls[registerRunListener.mock.calls.length - 1][0];
}

function resetMocks(): void {
  vi.clearAllMocks();
  getHub.mockReturnValue({ getClient, poll });
  getClient.mockReturnValue(undefined);
  poll.mockResolvedValue(undefined);
}

describe('Room driver flow actions', () => {
  beforeEach(() => {
    resetMocks();
  });

  it('registers the boost_room action card', async () => {
    const driver = initRoomDriver();
    await (driver.onInit as () => Promise<void>)();
    expect(getActionCard).toHaveBeenCalledWith('boost_room');
    expect(registerRunListener).toHaveBeenCalledTimes(1);
  });

  it('boost_room listener calls setRoomSetpointForDuration and polls', async () => {
    const setRoomSetpointForDuration = vi.fn();
    getClient.mockReturnValue({ setRoomSetpointForDuration } as unknown as WiserClient);
    const driver = initRoomDriver();
    await (driver.onInit as () => Promise<void>)();
    const listener = lastRunListener();
    await listener({
      device: makeDevice({ roomId: 3, hubId: 'hub-1' }),
      temperature: 22.5,
      duration: 45,
    });
    expect(getHub).toHaveBeenCalledWith('hub-1');
    expect(setRoomSetpointForDuration).toHaveBeenCalledWith(3, 22.5, 45);
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it('boost_room listener throws when hub is unavailable', async () => {
    getHub.mockReturnValue(null);
    const driver = initRoomDriver();
    await (driver.onInit as () => Promise<void>)();
    const listener = lastRunListener();
    await expect(listener({
      device: makeDevice({ roomId: 3, hubId: 'hub-missing' }),
      temperature: 22,
      duration: 30,
    })).rejects.toThrow('Hub not available');
  });
});

describe('HotWater driver flow actions', () => {
  beforeEach(() => {
    resetMocks();
  });

  it('registers the boost_hot_water action card', async () => {
    const driver = initHotWaterDriver();
    await (driver.onInit as () => Promise<void>)();
    expect(getActionCard).toHaveBeenCalledWith('boost_hot_water');
    expect(registerRunListener).toHaveBeenCalledTimes(1);
  });

  it('boost_hot_water listener calls setHotWaterOverride and polls', async () => {
    const setHotWaterOverride = vi.fn();
    getClient.mockReturnValue({ setHotWaterOverride } as unknown as WiserClient);
    const driver = initHotWaterDriver();
    await (driver.onInit as () => Promise<void>)();
    const listener = lastRunListener();
    await listener({
      device: makeDevice({ hotWaterId: 2, hubId: 'hub-1' }),
      duration: 30,
    });
    expect(getHub).toHaveBeenCalledWith('hub-1');
    expect(setHotWaterOverride).toHaveBeenCalledWith(2, 30);
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it('boost_hot_water listener throws when hub is unavailable', async () => {
    getHub.mockReturnValue(null);
    const driver = initHotWaterDriver();
    await (driver.onInit as () => Promise<void>)();
    const listener = lastRunListener();
    await expect(listener({
      device: makeDevice({ hotWaterId: 2, hubId: 'hub-missing' }),
      duration: 30,
    })).rejects.toThrow('Hub not available');
  });
});
