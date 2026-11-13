import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import { WiserClient, type FetchFn } from '../lib/wiser-client';
import { WiserAuthError, WiserRestError, WiserConnectionError } from '../lib/wiser-errors';
import domainFixture from './fixtures/domain.json';

function fakeResponse(opts: {
  ok?: boolean;
  status?: number;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
  arrayBuffer?: () => Promise<ArrayBuffer>;
}): unknown {
  const status = opts.status ?? 200;
  return {
    ok: opts.ok ?? (status >= 200 && status < 300),
    status,
    json: opts.json ?? (async () => ({})),
    text: opts.text ?? (async () => ''),
    arrayBuffer: opts.arrayBuffer ?? (async () => new ArrayBuffer(0)),
  };
}

function makeClient(opts: {
  fetchFn?: ReturnType<typeof vi.fn>;
  useHttps?: boolean;
  retries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
} = {}) {
  const fetchFn = opts.fetchFn ?? vi.fn();
  const client = new WiserClient({
    host: '192.168.0.95',
    secret: 's3cr3t',
    fetchFn: fetchFn as unknown as FetchFn,
    useHttps: opts.useHttps,
    retries: opts.retries ?? 3,
    retryDelayMs: opts.retryDelayMs ?? 0,
    timeoutMs: opts.timeoutMs,
  });
  return { client, fetchFn };
}

function lastCall(fetchFn: ReturnType<typeof vi.fn>, index = 0): [string, Record<string, unknown>] {
  const call = fetchFn.mock.calls[index];
  return [call[0] as string, call[1] as Record<string, unknown>];
}

describe('WiserClient.getDomain', () => {
  let fetchFn: ReturnType<typeof vi.fn>;
  let client: WiserClient;

  beforeEach(() => {
    const setup = makeClient();
    fetchFn = setup.fetchFn;
    client = setup.client;
  });

  it('fetches /data/v2/domain/ with SECRET header over HTTP and parses the body', async () => {
    fetchFn.mockResolvedValue(fakeResponse({ json: async () => domainFixture }));
    const domain = await client.getDomain();
    expect(domain.System?.BrandName).toBe('WiserHeat');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = lastCall(fetchFn);
    expect(url).toBe('http://192.168.0.95/data/v2/domain/');
    expect((init.headers as Record<string, string>).SECRET).toBe('s3cr3t');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(init.dispatcher).toBeUndefined();
  });

  it('uses HTTPS with a self-signed dispatcher when useHttps is true', async () => {
    const setup = makeClient({ useHttps: true });
    setup.fetchFn.mockResolvedValue(fakeResponse({ json: async () => domainFixture }));
    await setup.client.getDomain();
    const [url, init] = lastCall(setup.fetchFn);
    expect(url).toBe('https://192.168.0.95/data/v2/domain/');
    expect(init.dispatcher).toBeDefined();
  });
});

describe('WiserClient.verifyConnection', () => {
  it('returns true when BrandName is WiserHeat', async () => {
    const { client, fetchFn } = makeClient();
    fetchFn.mockResolvedValue(fakeResponse({ json: async () => domainFixture }));
    expect(await client.verifyConnection()).toBe(true);
  });

  it('returns false on an invalid BrandName', async () => {
    const { client, fetchFn } = makeClient();
    fetchFn.mockResolvedValue(fakeResponse({ json: async () => ({ System: { BrandName: 'Other' } }) }));
    expect(await client.verifyConnection()).toBe(false);
  });

  it('returns false on a connection error', async () => {
    const { client, fetchFn } = makeClient({ retries: 1 });
    fetchFn.mockRejectedValue(new TypeError('connect ECONNREFUSED'));
    expect(await client.verifyConnection()).toBe(false);
  });
});

describe('WiserClient.getSchedules', () => {
  it('fetches /data/v2/schedules/ and flattens typed schedule objects', async () => {
    const { client, fetchFn } = makeClient();
    fetchFn.mockResolvedValue(fakeResponse({
      json: async () => ({
        HotWater: [{ id: 1000, Type: 'HotWater', Monday: [630, -2230] }],
        Heating: [{ id: 1, Type: 'Heating', Monday: { Time: [390], DegreesC: [200] } }],
      }),
    }));
    const schedules = await client.getSchedules();
    expect(schedules).toHaveLength(2);
    expect(schedules[0].id).toBe(1000);
    expect(schedules[1].id).toBe(1);
    const [url] = lastCall(fetchFn);
    expect(url).toBe('http://192.168.0.95/data/v2/schedules/');
  });

  it('returns an empty array on 404', async () => {
    const { client, fetchFn } = makeClient();
    fetchFn.mockResolvedValue(fakeResponse({ status: 404, ok: false }));
    expect(await client.getSchedules()).toEqual([]);
  });
});

describe('WiserClient writes', () => {
  it('setRoomSetpoint PATCHes a Manual override SetPoint (×10)', async () => {
    const { client, fetchFn } = makeClient();
    fetchFn.mockResolvedValue(fakeResponse({}));
    await client.setRoomSetpoint(1, 21.5);
    const [url, init] = lastCall(fetchFn);
    expect(url).toBe('http://192.168.0.95/data/v2/domain/Room/1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({
      RequestOverride: { Type: 'Manual', SetPoint: 215 },
    });
  });

  it('setRoomMode PATCHes the mapped mode', async () => {
    const { client, fetchFn } = makeClient();
    fetchFn.mockResolvedValue(fakeResponse({}));
    await client.setRoomMode(1, 'auto');
    const [url, init] = lastCall(fetchFn);
    expect(url).toBe('http://192.168.0.95/data/v2/domain/Room/1');
    expect(JSON.parse(init.body as string)).toEqual({ Mode: 'Auto' });
  });

  it('setRoomMode PATCHes Manual mode', async () => {
    const { client, fetchFn } = makeClient();
    fetchFn.mockResolvedValue(fakeResponse({}));
    await client.setRoomMode(1, 'manual');
    const [url, init] = lastCall(fetchFn);
    expect(url).toBe('http://192.168.0.95/data/v2/domain/Room/1');
    expect(JSON.parse(init.body as string)).toEqual({ Mode: 'Manual' });
  });

  it('setRoomMode PATCHes Off mode', async () => {
    const { client, fetchFn } = makeClient();
    fetchFn.mockResolvedValue(fakeResponse({}));
    await client.setRoomMode(1, 'off');
    const [url, init] = lastCall(fetchFn);
    expect(url).toBe('http://192.168.0.95/data/v2/domain/Room/1');
    expect(JSON.parse(init.body as string)).toEqual({ Mode: 'Off' });
  });

  it('boostRoom PATCHes a Boost override with IncreaseSetPointBy', async () => {
    const { client, fetchFn } = makeClient();
    fetchFn.mockResolvedValue(fakeResponse({}));
    await client.boostRoom(1, 2.5, 60);
    const [url, init] = lastCall(fetchFn);
    expect(url).toBe('http://192.168.0.95/data/v2/domain/Room/1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({
      RequestOverride: { Type: 'Boost', IncreaseSetPointBy: 25, DurationMinutes: 60 },
    });
  });

  it('setRoomSetpointForDuration PATCHes a Manual override with SetPoint and DurationMinutes', async () => {
    const { client, fetchFn } = makeClient();
    fetchFn.mockResolvedValue(fakeResponse({}));
    await client.setRoomSetpointForDuration(1, 23.5, 45);
    const [url, init] = lastCall(fetchFn);
    expect(url).toBe('http://192.168.0.95/data/v2/domain/Room/1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({
      RequestOverride: { Type: 'Manual', SetPoint: 235, DurationMinutes: 45 },
    });
  });

  it('cancelRoomOverride PATCHes a None override', async () => {
    const { client, fetchFn } = makeClient();
    fetchFn.mockResolvedValue(fakeResponse({}));
    await client.cancelRoomOverride(1);
    const [, init] = lastCall(fetchFn);
    expect(JSON.parse(init.body as string)).toEqual({ RequestOverride: { Type: 'None' } });
  });

  it('setAwayMode PATCHes System', async () => {
    const { client, fetchFn } = makeClient();
    fetchFn.mockResolvedValue(fakeResponse({}));
    await client.setAwayMode(true);
    const [url, init] = lastCall(fetchFn);
    expect(url).toBe('http://192.168.0.95/data/v2/domain/System');
    expect(JSON.parse(init.body as string)).toEqual({ AwayMode: true });
  });

  it('setComfortMode PATCHes System', async () => {
    const { client, fetchFn } = makeClient();
    fetchFn.mockResolvedValue(fakeResponse({}));
    await client.setComfortMode(true);
    const [url, init] = lastCall(fetchFn);
    expect(url).toBe('http://192.168.0.95/data/v2/domain/System');
    expect(JSON.parse(init.body as string)).toEqual({ ComfortModeEnabled: true });
  });

  it('setEcoMode PATCHes System', async () => {
    const { client, fetchFn } = makeClient();
    fetchFn.mockResolvedValue(fakeResponse({}));
    await client.setEcoMode(true);
    const [url, init] = lastCall(fetchFn);
    expect(url).toBe('http://192.168.0.95/data/v2/domain/System');
    expect(JSON.parse(init.body as string)).toEqual({ EcoModeEnabled: true });
  });

  it('setHotWaterMode PATCHes the mapped hot water mode', async () => {
    const { client, fetchFn } = makeClient();
    fetchFn.mockResolvedValue(fakeResponse({}));
    await client.setHotWaterMode(2, 'on');
    const [url, init] = lastCall(fetchFn);
    expect(url).toBe('http://192.168.0.95/data/v2/domain/HotWater/2');
    expect(JSON.parse(init.body as string)).toEqual({ Mode: 'On' });
  });

  it('setHotWaterOverride PATCHes a Manual override with SetPoint 1100', async () => {
    const { client, fetchFn } = makeClient();
    fetchFn.mockResolvedValue(fakeResponse({}));
    await client.setHotWaterOverride(2, 30);
    const [, init] = lastCall(fetchFn);
    expect(JSON.parse(init.body as string)).toEqual({
      RequestOverride: { Type: 'Manual', SetPoint: 1100, DurationMinutes: 30 },
    });
  });
});

describe('WiserClient retry and fallback', () => {
  it('retries on 500 then succeeds', async () => {
    const { client, fetchFn } = makeClient({ retries: 3, retryDelayMs: 0 });
    fetchFn.mockResolvedValueOnce(fakeResponse({ status: 500, ok: false, text: async () => 'boom' }));
    fetchFn.mockResolvedValueOnce(fakeResponse({ json: async () => domainFixture }));
    const domain = await client.getDomain();
    expect(domain.System?.BrandName).toBe('WiserHeat');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('does not retry on 401 and throws WiserAuthError', async () => {
    const { client, fetchFn } = makeClient({ retries: 3, retryDelayMs: 0 });
    fetchFn.mockResolvedValue(fakeResponse({ status: 401, ok: false }));
    await expect(client.getDomain()).rejects.toBeInstanceOf(WiserAuthError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('does not retry on 404 and throws WiserRestError', async () => {
    const { client, fetchFn } = makeClient({ retries: 3, retryDelayMs: 0 });
    fetchFn.mockResolvedValue(fakeResponse({ status: 404, ok: false }));
    await expect(client.getDomain()).rejects.toBeInstanceOf(WiserRestError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('falls back from HTTP to HTTPS (self-signed) on a network error', async () => {
    const { client, fetchFn } = makeClient({ retries: 1, retryDelayMs: 0 });
    fetchFn.mockImplementation(async (url: string) => {
      if (url.startsWith('http://')) throw new TypeError('connect ECONNREFUSED');
      return fakeResponse({ json: async () => domainFixture });
    });
    const domain = await client.getDomain();
    expect(domain.System?.BrandName).toBe('WiserHeat');
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const [firstUrl] = lastCall(fetchFn, 0);
    const [secondUrl, secondInit] = lastCall(fetchFn, 1);
    expect(firstUrl.startsWith('http://')).toBe(true);
    expect(secondUrl.startsWith('https://')).toBe(true);
    expect(secondInit.dispatcher).toBeDefined();
  });

  it('throws WiserConnectionError when both HTTP and HTTPS fail', async () => {
    const { client, fetchFn } = makeClient({ retries: 1, retryDelayMs: 0 });
    fetchFn.mockRejectedValue(new TypeError('connect ECONNREFUSED'));
    await expect(client.getDomain()).rejects.toBeInstanceOf(WiserConnectionError);
  });

  it('uses HTTPS for a later write after a successful GET fallback', async () => {
    const { client, fetchFn } = makeClient({ retries: 1 });
    fetchFn.mockRejectedValueOnce(new TypeError('HTTP connection refused'));
    fetchFn.mockResolvedValueOnce(fakeResponse({ json: async () => domainFixture }));
    fetchFn.mockResolvedValueOnce(fakeResponse({}));

    await client.getDomain();
    await client.setRoomSetpoint(1, 20);

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(lastCall(fetchFn, 0)[0]).toBe('http://192.168.0.95/data/v2/domain/');
    expect(lastCall(fetchFn, 1)[0]).toBe('https://192.168.0.95/data/v2/domain/');
    const [writeUrl, writeInit] = lastCall(fetchFn, 2);
    expect(writeUrl).toBe('https://192.168.0.95/data/v2/domain/Room/1');
    expect(writeInit.method).toBe('PATCH');
    expect(writeInit.dispatcher).toBeDefined();
    await client.dispose();
  });

  it('does not retry a write after a server error', async () => {
    const { client, fetchFn } = makeClient({ retries: 3 });
    fetchFn.mockResolvedValue(fakeResponse({ status: 500, ok: false, text: async () => 'error' }));

    await expect(client.setRoomSetpoint(1, 20)).rejects.toBeInstanceOf(WiserRestError);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(lastCall(fetchFn)[1].method).toBe('PATCH');
    await client.dispose();
  });

  it('getOpentherm returns null on 404', async () => {
    const { client, fetchFn } = makeClient({ retries: 3, retryDelayMs: 0 });
    fetchFn.mockResolvedValue(fakeResponse({ status: 404, ok: false }));
    expect(await client.getOpentherm()).toBeNull();
  });
});

describe('WiserClient request lifetime', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('aborts stalled headers at the deadline and clears the timer', async () => {
    const { client, fetchFn } = makeClient({ useHttps: true, retries: 1, timeoutMs: 10 });
    fetchFn.mockImplementation(() => new Promise(() => {}));
    const pending = client.getDomain();
    const rejection = expect(pending).rejects.toThrow('timed out after 10ms');
    const [, init] = lastCall(fetchFn);
    expect((init.signal as AbortSignal).aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(10);

    await rejection;
    expect((init.signal as AbortSignal).aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await client.dispose();
  });

  it('keeps the deadline active while reading a stalled response body', async () => {
    const { client, fetchFn } = makeClient({ useHttps: true, retries: 1, timeoutMs: 10 });
    const json = vi.fn(() => new Promise(() => {}));
    fetchFn.mockResolvedValue(fakeResponse({ json }));
    const pending = client.getDomain();
    const rejection = expect(pending).rejects.toThrow('timed out after 10ms');
    await vi.advanceTimersByTimeAsync(0);
    expect(json).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10);

    await rejection;
    expect((lastCall(fetchFn)[1].signal as AbortSignal).aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await client.dispose();
  });

  it('aborts a timed-out attempt before starting its retry', async () => {
    vi.useRealTimers();
    const { client, fetchFn } = makeClient({ useHttps: true, retries: 2, timeoutMs: 10 });
    let abortObserved = false;
    fetchFn.mockImplementationOnce((url: string, init: { signal: AbortSignal }) => new Promise((_, reject) => {
      expect(url.startsWith('https://')).toBe(true);
      init.signal.addEventListener('abort', () => {
        abortObserved = true;
        reject(new Error('aborted'));
      }, { once: true });
    }));
    fetchFn.mockImplementationOnce(async () => {
      expect(abortObserved).toBe(true);
      return fakeResponse({ json: async () => domainFixture });
    });
    const pending = client.getDomain();
    const firstSignal = lastCall(fetchFn)[1].signal as AbortSignal;

    expect(await pending).toEqual(domainFixture);
    expect(firstSignal.aborted).toBe(true);
    expect(abortObserved).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    await client.dispose();
  });

  it('drains write responses and clears the timer on success', async () => {
    const { client, fetchFn } = makeClient({ useHttps: true, timeoutMs: 10 });
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
    fetchFn.mockResolvedValue(fakeResponse({ arrayBuffer }));

    await client.setRoomSetpoint(1, 20);

    expect(arrayBuffer).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    await client.dispose();
  });

  it('does not repeat a PATCH when its response body stalls after the write', async () => {
    const { client, fetchFn } = makeClient({ retries: 3, timeoutMs: 10 });
    const arrayBuffer = vi.fn(() => new Promise(() => {}));
    fetchFn.mockResolvedValue(fakeResponse({ arrayBuffer }));
    const pending = client.setHotWaterOverride(2, 30);
    const rejection = expect(pending).rejects.toThrow('timed out after 10ms');
    await vi.advanceTimersByTimeAsync(0);
    expect(arrayBuffer).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10);

    await rejection;
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(lastCall(fetchFn)[0]).toBe('http://192.168.0.95/data/v2/domain/HotWater/2');
    expect((lastCall(fetchFn)[1].signal as AbortSignal).aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await client.dispose();
  });

  it('cancels active work on disposal without retrying', async () => {
    const { client, fetchFn } = makeClient({ useHttps: true, retries: 3, timeoutMs: 100 });
    fetchFn.mockImplementation(() => new Promise(() => {}));
    const pending = client.getDomain();
    const rejection = expect(pending).rejects.toThrow('cancelled');
    const signal = lastCall(fetchFn)[1].signal as AbortSignal;

    await client.dispose();

    await rejection;
    expect(signal.aborted).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    await expect(client.getDomain()).rejects.toThrow('cancelled');
  });
});
