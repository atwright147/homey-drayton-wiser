import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import { WiserHub } from '../lib/wiser-hub';
import type { WiserDomain } from '../lib/wiser-types';
import domainFixture from './fixtures/domain.json';

function makeFakeClient(getDomain?: () => Promise<WiserDomain>) {
  return {
    getDomain: getDomain ?? vi.fn(async () => domainFixture as WiserDomain),
    getSchedules: vi.fn(async () => []),
  };
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
