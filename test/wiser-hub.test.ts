import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import { WiserHub } from '../lib/wiser-hub';
import type { WiserClient } from '../lib/wiser-client';
import type { WiserDomain } from '../lib/wiser-types';
import { WiserAuthError, WiserConnectionError } from '../lib/wiser-errors';
import domainFixture from './fixtures/domain.json';

function makeFakeClient(getDomain?: () => Promise<WiserDomain>) {
  return {
    getDomain: getDomain ?? vi.fn(async () => domainFixture as WiserDomain),
    getSchedules: vi.fn(async () => []),
  };
}

function asClient(client: ReturnType<typeof makeFakeClient>): WiserClient {
  return client as unknown as WiserClient;
}

describe('WiserHub register/unregister', () => {
  it('register fires the listener immediately when domain is already cached', async () => {
    const client = makeFakeClient();
    const hub = new WiserHub({ client });
    await hub.poll();
    const listener = vi.fn();
    hub.register('room:1', listener);
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(domainFixture);
  });

  it('register does not fire before the first poll', () => {
    const client = makeFakeClient();
    const hub = new WiserHub({ client });
    const listener = vi.fn();
    hub.register('room:1', listener);
    expect(listener).not.toHaveBeenCalled();
  });

  it('unregister removes the listener', async () => {
    const client = makeFakeClient();
    const hub = new WiserHub({ client });
    const listener = vi.fn();
    hub.register('room:1', listener);
    await hub.poll();
    const callsBefore = listener.mock.calls.length;
    hub.unregister('room:1');
    await hub.poll();
    expect(listener.mock.calls.length).toBe(callsBefore);
  });

  it('getDomain returns the latest cached domain', async () => {
    const client = makeFakeClient();
    const hub = new WiserHub({ client });
    expect(hub.getDomain()).toBeNull();
    await hub.poll();
    expect(hub.getDomain()).toBe(domainFixture);
  });
});

describe('WiserHub polling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('start triggers an immediate poll then repeats on the interval', async () => {
    const client = makeFakeClient();
    const hub = new WiserHub({ client, intervalMs: 30000 });
    const listener = vi.fn();
    hub.register('hub', listener);
    hub.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(client.getDomain).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30000);
    expect(client.getDomain).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledTimes(2);
    hub.stop();
  });

  it('stop clears the interval timer', async () => {
    const client = makeFakeClient();
    const hub = new WiserHub({ client, intervalMs: 10000 });
    hub.start();
    await vi.advanceTimersByTimeAsync(0);
    const callsAfterStart = (client.getDomain as ReturnType<typeof vi.fn>).mock.calls.length;
    hub.stop();
    await vi.advanceTimersByTimeAsync(30000);
    expect((client.getDomain as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterStart);
  });

  it('fan-out calls every registered listener on each poll', async () => {
    const client = makeFakeClient();
    const hub = new WiserHub({ client, intervalMs: 10000 });
    const l1 = vi.fn();
    const l2 = vi.fn();
    hub.register('room:1', l1);
    hub.register('roomstat:1', l2);
    hub.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(l1).toHaveBeenCalledTimes(1);
    expect(l2).toHaveBeenCalledTimes(1);
    hub.stop();
  });

  it('coalesces overlapping polls into a follow-up poll', async () => {
    let resolveFirst: (d: WiserDomain) => void = () => {};
    const firstPromise = new Promise<WiserDomain>((r) => {
      resolveFirst = r;
    });
    const getDomain = vi.fn()
      .mockReturnValueOnce(firstPromise)
      .mockResolvedValue(domainFixture);
    const client = makeFakeClient(getDomain);
    const hub = new WiserHub({ client });
    const inFlight = hub.poll();
    const second = hub.poll();
    expect(await second).toBeNull();
    expect(getDomain).toHaveBeenCalledTimes(1);
    resolveFirst(domainFixture as WiserDomain);
    await inFlight;
    await vi.advanceTimersByTimeAsync(0);
    expect(getDomain).toHaveBeenCalledTimes(2);
  });

  it('discards a poll that finishes after the hub stops', async () => {
    let resolveDomain: (domain: WiserDomain) => void = () => {};
    const domainPromise = new Promise<WiserDomain>((resolve) => {
      resolveDomain = resolve;
    });
    const client = makeFakeClient(vi.fn(() => domainPromise));
    const hub = new WiserHub({ client: asClient(client) });
    const listener = vi.fn();
    hub.register('room:1', listener);

    const pending = hub.poll();
    hub.stop();
    resolveDomain(domainFixture as WiserDomain);

    expect(await pending).toBeNull();
    expect(hub.getDomain()).toBeNull();
    expect(listener).not.toHaveBeenCalled();
    expect(client.getDomain).toHaveBeenCalledTimes(1);
  });

  it('replaces the client without publishing the old response or losing listeners', async () => {
    let resolveOld: (domain: WiserDomain) => void = () => {};
    const oldDomainPromise = new Promise<WiserDomain>((resolve) => {
      resolveOld = resolve;
    });
    const oldClient = {
      ...makeFakeClient(() => oldDomainPromise),
      abortPendingRequests: vi.fn(),
      dispose: vi.fn(async () => {}),
    };
    const newDomain = { Room: [{ id: 9 }] } as WiserDomain;
    const newClient = makeFakeClient(async () => newDomain);
    const hub = new WiserHub({ client: asClient(oldClient) });
    const listener = vi.fn();
    hub.register('room:1', listener);

    const oldPoll = hub.poll();
    hub.setClient(asClient(newClient));
    resolveOld(domainFixture as WiserDomain);

    expect(await oldPoll).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    expect(hub.getClient()).toBe(newClient);
    expect(hub.getDomain()).toBe(newDomain);
    expect(oldClient.abortPendingRequests).toHaveBeenCalledTimes(1);
    expect(oldClient.dispose).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(newDomain);
  });
});

describe('WiserHub setInterval', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('restarts the timer with the new interval when running', async () => {
    const client = makeFakeClient();
    const hub = new WiserHub({ client, intervalMs: 30000 });
    hub.start();
    await vi.advanceTimersByTimeAsync(0);
    const callsAtStart = (client.getDomain as ReturnType<typeof vi.fn>).mock.calls.length;
    hub.setInterval(10000);
    await vi.advanceTimersByTimeAsync(10000);
    expect((client.getDomain as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(callsAtStart);
    hub.stop();
  });
});

describe('WiserHub connection health', () => {
  it('reports an initial failure immediately without exposing the error text', async () => {
    const getDomain = vi.fn().mockRejectedValue(new WiserConnectionError('secret-sensitive-detail'));
    const hub = new WiserHub({ client: asClient(makeFakeClient(getDomain)) });
    const listener = vi.fn();
    hub.registerHealth('room:1', listener);
    await Promise.resolve();
    expect(listener).toHaveBeenCalledWith({ available: false, reason: 'not_ready', lastSuccessAt: null });

    await expect(hub.poll()).rejects.toThrow('secret-sensitive-detail');

    expect(hub.getHealth()).toEqual({ available: false, reason: 'connection', lastSuccessAt: null });
    expect(hub.getDomain()).toBeNull();
    expect(listener).toHaveBeenLastCalledWith(hub.getHealth());
    expect(JSON.stringify(hub.getHealth())).not.toContain('secret-sensitive-detail');
  });

  it('retains the last domain for two failures, then clears it and recovers', async () => {
    const domain = { Room: [{ id: 1 }] } as WiserDomain;
    const getDomain = vi.fn()
      .mockResolvedValueOnce(domain)
      .mockRejectedValueOnce(new WiserConnectionError('offline'))
      .mockRejectedValueOnce(new WiserConnectionError('offline'))
      .mockRejectedValueOnce(new WiserConnectionError('offline'))
      .mockResolvedValueOnce(domain);
    const hub = new WiserHub({ client: asClient(makeFakeClient(getDomain)) });
    const listener = vi.fn();
    hub.registerHealth('room:1', listener);

    await hub.poll();
    expect(hub.getHealth()).toMatchObject({ available: true, reason: null });
    for (let i = 0; i < 2; i++) {
      await expect(hub.poll()).rejects.toThrow('offline');
      expect(hub.getHealth().available).toBe(true);
      expect(hub.getDomain()).toBe(domain);
    }
    await expect(hub.poll()).rejects.toThrow('offline');
    expect(hub.getHealth()).toMatchObject({ available: false, reason: 'connection' });
    expect(hub.getDomain()).toBeNull();

    await hub.poll();
    expect(hub.getHealth()).toMatchObject({ available: true, reason: null });
    expect(hub.getDomain()).toBe(domain);
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it('reports authentication failure immediately after a successful poll', async () => {
    const getDomain = vi.fn()
      .mockResolvedValueOnce(domainFixture)
      .mockRejectedValueOnce(new WiserAuthError('authentication failed'));
    const hub = new WiserHub({ client: asClient(makeFakeClient(getDomain)) });
    await hub.poll();

    await expect(hub.poll()).rejects.toBeInstanceOf(WiserAuthError);

    expect(hub.getHealth()).toMatchObject({ available: false, reason: 'authentication' });
    expect(hub.getDomain()).toBeNull();
  });

  it('expires cached data after twice the poll interval', async () => {
    vi.useFakeTimers();
    try {
      const getDomain = vi.fn()
        .mockResolvedValueOnce(domainFixture)
        .mockRejectedValueOnce(new WiserConnectionError('offline'));
      const hub = new WiserHub({ client: asClient(makeFakeClient(getDomain)), intervalMs: 30000 });
      await hub.poll();
      await vi.advanceTimersByTimeAsync(60000);

      await expect(hub.poll()).rejects.toThrow('offline');

      expect(hub.getHealth().available).toBe(false);
      expect(hub.getDomain()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('isolates data and health listener errors from other subscribers', async () => {
    const hub = new WiserHub({ client: asClient(makeFakeClient()) });
    const dataListener = vi.fn();
    const healthListener = vi.fn();
    hub.register('bad-data', () => {
      throw new Error('device callback failed');
    });
    hub.register('good-data', dataListener);
    hub.registerHealth('bad-health', () => {
      throw new Error('status callback failed');
    });
    hub.registerHealth('good-health', healthListener);

    await expect(hub.poll()).resolves.toEqual(domainFixture);

    expect(dataListener).toHaveBeenCalledWith(domainFixture);
    expect(healthListener).toHaveBeenLastCalledWith(expect.objectContaining({ available: true }));
    expect(hub.getHealth().available).toBe(true);
  });

  it('isolates a listener error during cached-domain delivery', async () => {
    const hub = new WiserHub({ client: asClient(makeFakeClient()) });
    await hub.poll();

    expect(() => hub.register('bad-data', () => {
      throw new Error('device callback failed');
    })).not.toThrow();
    await Promise.resolve();

    expect(hub.getHealth().available).toBe(true);
    expect(hub.getDomain()).toEqual(domainFixture);
  });

  it('clears cached data and reports not ready when stopped', async () => {
    const hub = new WiserHub({ client: asClient(makeFakeClient()) });
    await hub.poll();
    hub.stop();

    expect(hub.getHealth()).toMatchObject({ available: false, reason: 'not_ready' });
    expect(hub.getDomain()).toBeNull();
  });
});
