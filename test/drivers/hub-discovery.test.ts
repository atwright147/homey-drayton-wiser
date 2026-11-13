/* eslint-disable max-classes-per-file */
import { EventEmitter } from 'node:events';
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { WiserClient } from '../../lib/wiser-client';
import WiserHubManager from '../../lib/wiser-hub-manager';
import * as HubDeviceModule from '../../drivers/hub/device';
import type { WiserDomain } from '../../lib/wiser-types';

vi.mock('homey', () => ({
  default: {
    Device: class {},
    Driver: class {},
    App: class {},
  },
}));

type TestHubDevice = Record<string, unknown> & {
  onInit: () => Promise<void>;
  onDeleted: () => Promise<void>;
  onSettings: (event: {
    oldSettings: Record<string, unknown>;
    newSettings: Record<string, unknown>;
    changedKeys: string[];
  }) => Promise<void>;
  onDiscoveryResult: (result: { id: string }) => boolean;
  onDiscoveryAddressChanged: (result: EventEmitter & { id: string; address: string }) => void;
  discoveryQueue: Promise<void>;
  repairConnection: (data: { ip: string; secret?: string; discoveryId?: string | null }, sessionActive: () => boolean) => Promise<void>;
};

const HubDevice = ((HubDeviceModule as { default?: unknown }).default ?? HubDeviceModule) as new () => TestHubDevice;
const domain = { System: { BrandName: 'WiserHeat', ChipId: 'chip-1' } } as WiserDomain;

function discoveryResult(id: string, address: string): EventEmitter & { id: string; address: string } {
  return Object.assign(new EventEmitter(), { id, address });
}

function makeHub(
  storeOverrides: Record<string, unknown> = {},
  initialResults: Array<EventEmitter & { id: string; address: string }> = [],
  dataId = 'chip-1',
) {
  const manager = new WiserHubManager();
  const results: Record<string, EventEmitter & { id: string; address: string }> = {};
  initialResults.forEach((result) => {
    results[result.id] = result;
  });
  const strategy = Object.assign(new EventEmitter(), { getDiscoveryResults: () => results });
  const store: Record<string, unknown> = {
    address: '192.0.2.1', secret: 'test-secret', ...storeOverrides,
  };
  const device = new HubDevice();
  device.homey = { app: { hubManager: manager } };
  device.driver = { getDiscoveryStrategy: () => strategy };
  device.getData = () => ({ id: dataId });
  device.getName = () => 'Hub';
  device.getStoreValue = (key: string) => store[key];
  device.setStoreValue = vi.fn(async (key: string, value: unknown) => {
    store[key] = value;
  });
  device.unsetStoreValue = vi.fn(async (key: string) => {
    delete store[key];
  });
  device.getSetting = () => false;
  device.getSettings = () => ({ pollInterval: 30, useHttps: false });
  device.hasCapability = () => true;
  device.addCapability = vi.fn().mockResolvedValue(undefined);
  device.setCapabilityValue = vi.fn().mockResolvedValue(undefined);
  device.setSettings = vi.fn().mockResolvedValue(undefined);
  device.setAvailable = vi.fn().mockResolvedValue(undefined);
  device.setUnavailable = vi.fn().mockResolvedValue(undefined);
  device.registerCapabilityListener = vi.fn();
  device.log = vi.fn();
  device.error = vi.fn();
  return {
    device, manager, results, strategy, store,
  };
}

describe('hub discovery address recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(WiserClient.prototype, 'getDomain').mockResolvedValue(domain);
    vi.spyOn(WiserClient.prototype, 'getSchedules').mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('matches a stored discovery identity and verifies a changed address before switching clients', async () => {
    const verify = vi.spyOn(WiserClient.prototype, 'verifyConnectionWithDomain').mockResolvedValue(domain);
    const result = discoveryResult('service-1', '192.0.2.2');
    const { device, manager, store } = makeHub({ discoveryId: 'service-1' }, [result]);

    await device.onInit();
    const hub = manager.get('chip-1');
    await device.discoveryQueue;

    expect(device.onDiscoveryResult(result)).toBe(true);
    expect(device.onDiscoveryResult({ id: 'other-service' })).toBe(false);
    expect(verify).toHaveBeenCalledOnce();
    expect(store.address).toBe('192.0.2.2');
    expect(manager.get('chip-1')).toBe(hub);
    expect((hub?.getClient() as unknown as { host: string }).host).toBe('192.0.2.2');
    await device.onDeleted();
  });

  it('migrates a legacy ChipId device from current and future discovery events', async () => {
    vi.spyOn(WiserClient.prototype, 'verifyConnectionWithDomain').mockResolvedValue(domain);
    const {
      device, results, strategy, store,
    } = makeHub();
    await device.onInit();
    expect(device.onDiscoveryResult({ id: 'service-1' })).toBe(false);

    const result = discoveryResult('service-1', '192.0.2.2');
    results[result.id] = result;
    strategy.emit('result', result);
    await device.discoveryQueue;
    expect(store.discoveryId).toBe('service-1');
    expect(store.address).toBe('192.0.2.2');
    expect(device.onDiscoveryResult(result)).toBe(true);

    result.address = '192.0.2.3';
    result.emit('addressChanged', result);
    await device.discoveryQueue;
    expect(store.address).toBe('192.0.2.3');

    await device.onDeleted();
    expect(strategy.listenerCount('result')).toBe(0);
    expect(result.listenerCount('addressChanged')).toBe(0);
  });

  it('migrates a legacy ChipId device from an already discovered service', async () => {
    const verify = vi.spyOn(WiserClient.prototype, 'verifyConnectionWithDomain').mockResolvedValue(domain);
    const result = discoveryResult('service-1', '192.0.2.2');
    const { device, store } = makeHub({}, [result]);
    await device.onInit();
    await device.discoveryQueue;

    expect(verify).toHaveBeenCalledOnce();
    expect(store.discoveryId).toBe('service-1');
    expect(store.address).toBe('192.0.2.2');
    await device.onDeleted();
  });

  it('does not migrate an address-based device without a known ChipId or a mismatched service', async () => {
    vi.mocked(WiserClient.prototype.getDomain).mockResolvedValue({ System: { BrandName: 'WiserHeat' } });
    const verify = vi.spyOn(WiserClient.prototype, 'verifyConnectionWithDomain').mockResolvedValue(domain);
    const result = discoveryResult('service-2', '192.0.2.2');
    const manual = makeHub({}, [result], '192.0.2.1');
    await manual.device.onInit();
    await manual.device.discoveryQueue;
    expect(manual.store.discoveryId).toBeUndefined();
    expect(manual.store.address).toBe('192.0.2.1');
    await manual.device.onDeleted();

    const mismatched = makeHub({ discoveryId: 'service-1' }, [result]);
    await mismatched.device.onInit();
    await mismatched.device.discoveryQueue;
    expect(mismatched.store.address).toBe('192.0.2.1');
    await mismatched.device.onDeleted();
    expect(verify).not.toHaveBeenCalled();
  });

  it('rejects an unverified address and persists an approved one across restart', async () => {
    const verify = vi.spyOn(WiserClient.prototype, 'verifyConnectionWithDomain')
      .mockResolvedValueOnce({ System: { BrandName: 'Other', ChipId: 'chip-1' } })
      .mockResolvedValueOnce({ System: { BrandName: 'WiserHeat', ChipId: 'other-chip' } })
      .mockResolvedValue(domain);
    const result = discoveryResult('service-1', '192.0.2.2');
    const first = makeHub({ discoveryId: 'service-1' }, [result]);
    await first.device.onInit();
    await first.device.discoveryQueue;
    expect(first.store.address).toBe('192.0.2.1');

    first.device.onDiscoveryAddressChanged(result);
    await first.device.discoveryQueue;
    expect(first.store.address).toBe('192.0.2.1');

    first.device.onDiscoveryAddressChanged(result);
    await first.device.discoveryQueue;
    expect(first.store.address).toBe('192.0.2.2');
    await first.device.onDeleted();

    const restarted = makeHub(first.store, [result]);
    await restarted.device.onInit();
    await restarted.device.discoveryQueue;
    expect(restarted.store.address).toBe('192.0.2.2');
    expect((restarted.manager.get('chip-1')?.getClient() as unknown as { host: string }).host).toBe('192.0.2.2');
    expect(verify).toHaveBeenCalledTimes(3);
    await restarted.device.onDeleted();
  });

  it('uses the latest HTTPS setting after a delayed address verification', async () => {
    let releaseVerification: (value: WiserDomain) => void = () => {};
    let verificationEntered: () => void = () => {};
    const pendingVerification = new Promise<WiserDomain>((resolve) => {
      releaseVerification = resolve;
    });
    const enteredVerification = new Promise<void>((resolve) => {
      verificationEntered = resolve;
    });
    vi.spyOn(WiserClient.prototype, 'verifyConnectionWithDomain').mockImplementation(() => {
      verificationEntered();
      return pendingVerification;
    });
    const result = discoveryResult('service-1', '192.0.2.2');
    const { device, manager } = makeHub({ discoveryId: 'service-1' }, [result]);
    await device.onInit();
    await enteredVerification;

    await device.onSettings({
      oldSettings: { useHttps: false, pollInterval: 30 },
      newSettings: { useHttps: true, pollInterval: 30 },
      changedKeys: ['useHttps'],
    });
    releaseVerification(domain);
    await device.discoveryQueue;

    const client = manager.get('chip-1')?.getClient() as unknown as { host: string; useHttps: boolean };
    expect(client.host).toBe('192.0.2.2');
    expect(client.useHttps).toBe(true);
    await device.onDeleted();
  });
});

describe('hub repair', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(WiserClient.prototype, 'getDomain').mockResolvedValue(domain);
    vi.spyOn(WiserClient.prototype, 'getSchedules').mockResolvedValue([]);
    vi.spyOn(WiserClient.prototype, 'verifyConnectionWithDomain').mockResolvedValue(domain);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('updates the existing hub client and delivers fresh data to existing child subscriptions', async () => {
    const { device, manager, store } = makeHub();
    const listener = vi.fn();
    manager.subscribe('chip-1', 'child', listener);
    await device.onInit();
    await vi.advanceTimersByTimeAsync(0);
    const hub = manager.get('chip-1');
    const oldClient = hub?.getClient();
    const dispose = vi.spyOn(oldClient!, 'dispose');
    listener.mockClear();
    await device.repairConnection({ ip: ' 192.0.2.9 ', secret: ' new-secret ' }, () => true);
    await vi.advanceTimersByTimeAsync(0);

    expect(store).toMatchObject({ address: '192.0.2.9', secret: 'new-secret', chipId: 'chip-1' });
    expect(manager.get('chip-1')).toBe(hub);
    expect(hub?.getClient()).not.toBe(oldClient);
    expect(hub?.getClient()).toMatchObject({ host: '192.0.2.9', secret: 'new-secret' });
    expect(dispose).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(domain);
    expect(hub?.getHealth().available).toBe(true);
    await device.onDeleted();

    const restarted = makeHub(store);
    await restarted.device.onInit();
    expect(restarted.manager.get('chip-1')?.getClient()).toMatchObject({ host: '192.0.2.9', secret: 'new-secret' });
    await restarted.device.onDeleted();
  });

  it('retains the saved secret for a blank field and respects HTTPS', async () => {
    const { device, manager, store } = makeHub();
    device.getSettings = () => ({ pollInterval: 30, useHttps: true });
    await device.onInit();
    await device.repairConnection({ ip: '192.0.2.9', secret: ' ' }, () => true);
    expect(store.secret).toBe('test-secret');
    expect(manager.get('chip-1')?.getClient()).toMatchObject({ useHttps: true, secret: 'test-secret' });
    const verifier = vi.mocked(WiserClient.prototype.verifyConnectionWithDomain).mock.instances[0];
    expect(verifier).toMatchObject({ useHttps: true, secret: 'test-secret' });
    await device.onDeleted();
  });

  it.each([
    [null, 'Could not connect'],
    [{ System: { BrandName: 'Other', ChipId: 'chip-1' } }, 'Could not connect'],
    [{ System: { BrandName: 'WiserHeat', ChipId: 'chip-2' } }, 'different HeatHub'],
    [{ System: { BrandName: 'WiserHeat' } }, 'different HeatHub'],
  ])('leaves the stored connection and active client unchanged for rejected identity %j', async (response, message) => {
    const { device, manager, store } = makeHub();
    await device.onInit();
    const original = { ...store };
    const client = manager.get('chip-1')?.getClient();
    const dispose = vi.spyOn(WiserClient.prototype, 'dispose');
    vi.mocked(WiserClient.prototype.verifyConnectionWithDomain).mockResolvedValue(response as WiserDomain | null);
    await expect(device.repairConnection({ ip: '192.0.2.9', secret: 'new-secret' }, () => true)).rejects.toThrow(message as string);
    expect(store).toEqual(original);
    expect(manager.get('chip-1')?.getClient()).toBe(client);
    expect(dispose).toHaveBeenCalledOnce();
    await device.onDeleted();
  });

  it('sanitizes verification failures and disposes the verifier', async () => {
    const { device, store } = makeHub();
    await device.onInit();
    const dispose = vi.spyOn(WiserClient.prototype, 'dispose');
    vi.mocked(WiserClient.prototype.verifyConnectionWithDomain).mockRejectedValue(new Error('sensitive failure'));
    await expect(device.repairConnection({ ip: '192.0.2.9' }, () => true)).rejects.toThrow('Could not connect');
    expect(store.address).toBe('192.0.2.1');
    expect(dispose).toHaveBeenCalledOnce();
    await device.onDeleted();
  });

  it('rolls back stored credentials when persistence fails without switching the client', async () => {
    const { device, manager, store } = makeHub();
    await device.onInit();
    const original = { ...store };
    const client = manager.get('chip-1')?.getClient();
    const save = device.setStoreValue as (key: string, value: unknown) => Promise<void>;
    device.setStoreValue = vi.fn(async (key: string, value: unknown) => {
      if (key === 'secret' && value === 'new-secret') throw new Error('storage failed');
      await save(key, value);
    });
    await expect(device.repairConnection({ ip: '192.0.2.9', secret: 'new-secret' }, () => true)).rejects.toThrow('Could not save');
    expect(store).toEqual(original);
    expect(manager.get('chip-1')?.getClient()).toBe(client);
    await device.onDeleted();
  });

  it.each(['disconnect', 'delete'])('does not save a delayed verification after %s', async (action) => {
    const { device, store } = makeHub();
    await device.onInit();
    let active = true;
    let release: (value: WiserDomain) => void = () => {};
    vi.mocked(WiserClient.prototype.verifyConnectionWithDomain).mockImplementation(() => new Promise((resolve) => {
      release = resolve;
    }));
    const repair = device.repairConnection({ ip: '192.0.2.9' }, () => active);
    await vi.advanceTimersByTimeAsync(0);
    if (action === 'delete') await device.onDeleted();
    else active = false;
    release(domain);
    await expect(repair).rejects.toThrow('session has ended');
    expect(store.address).toBe('192.0.2.1');
    await device.onDeleted();
  });

  it('rejects discovery movement during verification and accepts a fresh selection', async () => {
    const result = discoveryResult('service-1', '192.0.2.9');
    const { device, results, store } = makeHub();
    await device.onInit();
    results[result.id] = result;
    vi.mocked(WiserClient.prototype.verifyConnectionWithDomain).mockImplementationOnce(async () => {
      result.address = '192.0.2.10';
      return domain;
    });
    await expect(device.repairConnection({ ip: '192.0.2.9', discoveryId: result.id }, () => true)).rejects.toThrow('hub has moved');
    expect(store.address).toBe('192.0.2.1');
    await device.repairConnection({ ip: '192.0.2.10', discoveryId: result.id }, () => true);
    expect(store.discoveryId).toBe(result.id);
    expect(store.address).toBe('192.0.2.10');
    await device.onDeleted();
  });

  it('learns a legacy hub identity and preserves its address-based data ID through repair and discovery', async () => {
    const {
      device, manager, store, results, strategy,
    } = makeHub({}, [], '192.0.2.1');
    await device.onInit();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.chipId).toBe('chip-1');
    await device.repairConnection({ ip: '192.0.2.9' }, () => true);
    expect(manager.get('192.0.2.1')?.getClient()).toMatchObject({ host: '192.0.2.9' });
    const result = discoveryResult('service-1', '192.0.2.10');
    results[result.id] = result;
    strategy.emit('result', result);
    await device.discoveryQueue;
    expect(store.address).toBe('192.0.2.10');
    expect(manager.get('192.0.2.1')?.getClient()).toMatchObject({ host: '192.0.2.10' });
    await device.onDeleted();
  });

  it('rejects repair for an unknown legacy identity', async () => {
    vi.mocked(WiserClient.prototype.getDomain).mockRejectedValue(new Error('offline'));
    const { device, store } = makeHub({}, [], '192.0.2.1');
    await device.onInit();
    await expect(device.repairConnection({ ip: '192.0.2.9' }, () => true)).rejects.toThrow('no saved hub identity');
    expect(store.address).toBe('192.0.2.1');
    expect(WiserClient.prototype.verifyConnectionWithDomain).not.toHaveBeenCalled();
    await device.onDeleted();
  });

  it('can repair missing credentials when a stable identity exists', async () => {
    const { device, manager } = makeHub({ address: undefined, secret: undefined });
    await device.onInit();
    expect(manager.get('chip-1')).toBeUndefined();
    await device.repairConnection({ ip: '192.0.2.9', secret: 'new-secret' }, () => true);
    await vi.advanceTimersByTimeAsync(0);
    expect(manager.get('chip-1')?.getHealth().available).toBe(true);
    await device.onDeleted();
  });
});
