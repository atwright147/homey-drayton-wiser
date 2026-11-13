import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import { WiserHub } from '../lib/wiser-hub';
import type { WiserClient } from '../lib/wiser-client';
import type { WiserDomain } from '../lib/wiser-types';
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
    const oldClient = makeFakeClient(() => oldDomainPromise);
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
