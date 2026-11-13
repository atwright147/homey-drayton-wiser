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
    const listener = vi.fn();
    manager.register('hub-1', oldHub);
    manager.subscribe('hub-1', 'room:1', listener);
    oldHub.start();
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));

    manager.register('hub-1', newHub);
    expect(oldHub.isRunning()).toBe(false);
    manager.unregister('hub-1', oldHub);
    expect(manager.get('hub-1')).toBe(newHub);
    await newHub.poll();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith({ Room: [{ id: 2 }] });
    manager.unregister('hub-1', newHub);
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
});
