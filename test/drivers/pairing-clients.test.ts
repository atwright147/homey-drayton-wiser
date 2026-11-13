/* eslint-disable max-classes-per-file */
import {
  beforeEach, describe, expect, it, vi,
} from 'vitest';
import { WiserClient } from '../../lib/wiser-client';
import * as HubDriverModule from '../../drivers/hub/driver';
import * as HotWaterDriverModule from '../../drivers/hotwater/driver';
import type { WiserDomain } from '../../lib/wiser-types';

vi.mock('homey', () => ({
  default: {
    Driver: class {},
    Device: class {},
    App: class {},
  },
}));

type TestDriver = Record<string, unknown> & {
  onPair: (session: unknown) => Promise<void>;
  onPairListDevices: () => Promise<unknown[]>;
};

const HubDriver = ((HubDriverModule as { default?: unknown }).default ?? HubDriverModule) as new () => TestDriver;
const HotWaterDriver = ((HotWaterDriverModule as { default?: unknown }).default ?? HotWaterDriverModule) as new () => TestDriver;

function makeHubPairSession() {
  const handlers: Map<string, (value?: unknown) => Promise<unknown>> = new Map();
  return {
    handlers,
    session: {
      setHandler: (name: string, handler: (value?: unknown) => Promise<unknown>) => handlers.set(name, handler),
    },
  };
}

describe('temporary pairing client cleanup', () => {
  const domain = { System: { BrandName: 'WiserHeat', ChipId: 'chip-1' }, HotWater: [{ id: 1 }] } as WiserDomain;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('disposes the hub login and list clients on success and failure', async () => {
    const dispose = vi.spyOn(WiserClient.prototype, 'dispose').mockResolvedValue(undefined);
    const verify = vi.spyOn(WiserClient.prototype, 'verifyConnectionWithDomain')
      .mockResolvedValueOnce(domain)
      .mockResolvedValueOnce(null);
    const getDomain = vi.spyOn(WiserClient.prototype, 'getDomain')
      .mockResolvedValueOnce(domain)
      .mockRejectedValueOnce(new Error('offline'));
    const driver = new HubDriver();
    driver.log = vi.fn();
    const { handlers, session } = makeHubPairSession();
    await driver.onPair(session);
    const login = handlers.get('login') as (data: { ip: string; secret: string }) => Promise<boolean>;
    const listDevices = handlers.get('list_devices') as () => Promise<unknown[]>;

    await expect(login({ ip: '192.0.2.1', secret: 'test-secret' })).resolves.toBe(true);
    await expect(listDevices()).resolves.toHaveLength(1);
    await expect(login({ ip: '192.0.2.1', secret: 'bad-secret' })).rejects.toThrow('Could not connect');
    await expect(listDevices()).rejects.toThrow('offline');
    expect(verify).toHaveBeenCalledTimes(2);
    expect(getDomain).toHaveBeenCalledTimes(2);
    expect(dispose).toHaveBeenCalledTimes(4);
  });

  it('disposes the hot water direct-poll client on success and failure', async () => {
    const dispose = vi.spyOn(WiserClient.prototype, 'dispose').mockResolvedValue(undefined);
    vi.spyOn(WiserClient.prototype, 'getDomain')
      .mockResolvedValueOnce(domain)
      .mockRejectedValueOnce(new Error('offline'));
    vi.spyOn(WiserClient.prototype, 'getSchedules').mockResolvedValue([]);
    const driver = new HotWaterDriver();
    driver.log = vi.fn();
    driver.error = vi.fn();
    const hubDevice = {
      getData: () => ({ id: 'hub-1' }),
      getStoreValue: (key: string) => ({ address: '192.0.2.1', secret: 'test-secret' })[key as 'address' | 'secret'],
      getSetting: () => false,
    };
    driver.homey = {
      drivers: { getDriver: () => ({ getDevices: () => [hubDevice] }) },
      app: { hubManager: { get: () => undefined } },
    };

    await expect(driver.onPairListDevices()).resolves.toHaveLength(1);
    await expect(driver.onPairListDevices()).resolves.toHaveLength(0);
    expect(dispose).toHaveBeenCalledTimes(2);
  });
});
