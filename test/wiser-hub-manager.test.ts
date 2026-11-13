import {
  describe, expect, it, vi,
} from 'vitest';
import { WiserHub } from '../lib/wiser-hub';
import type { WiserClient } from '../lib/wiser-client';
import type { WiserDomain } from '../lib/wiser-types';
import WiserHubManager from '../lib/wiser-hub-manager';

function makeHub(domain: WiserDomain): WiserHub {
  const client = {
    getDomain: vi.fn(async () => domain),
    getSchedules: vi.fn(async () => []),
  } as unknown as WiserClient;
  return new WiserHub({ client });
}

describe('WiserHubManager subscriptions', () => {
  it('attaches a child registered before its parent and leaves the parent running after child removal', async () => {
    const manager = new WiserHubManager();
    const listener = vi.fn();
    manager.subscribe('hub-1', 'room:1', listener);
    expect(manager.get('hub-1')).toBeUndefined();

    const hub = makeHub({ Room: [{ id: 1 }] });
    manager.register('hub-1', hub);
    hub.start();
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));

    manager.unsubscribe('hub-1', 'room:1');
    expect(manager.get('hub-1')).toBe(hub);
    expect(hub.isRunning()).toBe(true);
    await hub.poll();
    expect(listener).toHaveBeenCalledTimes(1);
    manager.unregister('hub-1', hub);
  });

  it('reattaches subscribers to a replacement and ignores stale unregister calls', async () => {
    const manager = new WiserHubManager();
    const oldHub = makeHub({ Room: [{ id: 1 }] });
    const newHub = makeHub({ Room: [{ id: 2 }] });
    const oldDispose = vi.spyOn(oldHub, 'dispose');
    const newDispose = vi.spyOn(newHub, 'dispose');
    const listener = vi.fn();
    manager.register('hub-1', oldHub);
    manager.subscribe('hub-1', 'room:1', listener);
    oldHub.start();
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));

    manager.register('hub-1', newHub);
    expect(oldHub.isRunning()).toBe(false);
    expect(oldDispose).toHaveBeenCalledTimes(1);
    manager.unregister('hub-1', oldHub);
    expect(manager.get('hub-1')).toBe(newHub);
    expect(newDispose).not.toHaveBeenCalled();
    await newHub.poll();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith({ Room: [{ id: 2 }] });
    manager.unregister('hub-1', newHub);
    expect(newDispose).toHaveBeenCalledTimes(1);
  });

  it('keeps subscriptions across parent removal and cleans them on unsubscribe', async () => {
    const manager = new WiserHubManager();
    const firstHub = makeHub({ Room: [{ id: 1 }] });
    const nextHub = makeHub({ Room: [{ id: 2 }] });
    const listener = vi.fn();
    manager.register('hub-1', firstHub);
    manager.subscribe('hub-1', 'room:1', listener);
    manager.unregister('hub-1', firstHub);
    manager.register('hub-1', nextHub);
    await nextHub.poll();
    expect(listener).toHaveBeenCalledTimes(1);

    manager.unsubscribe('hub-1', 'room:1');
    await nextHub.poll();
    expect(listener).toHaveBeenCalledTimes(1);
    manager.unregister('hub-1', nextHub);
  });

  it('attaches health listeners registered before the parent and removes them independently', async () => {
    const manager = new WiserHubManager();
    const healthListener = vi.fn();
    const domainListener = vi.fn();
    manager.subscribeHealth('hub-1', 'room:1', healthListener);
    manager.subscribe('hub-1', 'room:1', domainListener);
    await Promise.resolve();
    expect(healthListener).toHaveBeenCalledWith({ available: false, reason: 'not_ready', lastSuccessAt: null });

    const hub = makeHub({ Room: [{ id: 1 }] });
    manager.register('hub-1', hub);
    await hub.poll();
    expect(healthListener).toHaveBeenLastCalledWith(expect.objectContaining({ available: true }));
    expect(domainListener).toHaveBeenCalledTimes(1);

    manager.unsubscribeHealth('hub-1', 'room:1');
    manager.unregister('hub-1', hub);
    expect(healthListener).toHaveBeenCalledTimes(3);
    manager.unsubscribe('hub-1', 'room:1');
  });

  it('reattaches health listeners when a parent hub is replaced', async () => {
    const manager = new WiserHubManager();
    const oldHub = makeHub({ Room: [{ id: 1 }] });
    const newHub = makeHub({ Room: [{ id: 2 }] });
    const listener = vi.fn();
    manager.register('hub-1', oldHub);
    manager.subscribeHealth('hub-1', 'room:1', listener);
    await oldHub.poll();
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ available: true }));

    manager.register('hub-1', newHub);
    await newHub.poll();

    expect(manager.get('hub-1')).toBe(newHub);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ available: true }));
    manager.unsubscribeHealth('hub-1', 'room:1');
    manager.unregister('hub-1', newHub);
  });
});
