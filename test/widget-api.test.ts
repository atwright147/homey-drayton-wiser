import {
  describe, expect, it, vi,
} from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import * as scheduleUtils from '../lib/wiser-utils';

const apiModule: { exports: {
  getSchedule?: (args: { homey: unknown; params: { deviceId: string } }) => Promise<{
    available: boolean;
    state: boolean | null;
    target: string | null;
    nextEvent: string | null;
    activeSlot: { day: string; index: number } | null;
    schedule: unknown;
  }>;
} } = { exports: {} };
const apiSource = readFileSync(join(process.cwd(), 'widgets/wiser-schedule/api.js'), 'utf8');
function loadGetSchedule(now?: string) {
  const moduleInstance: typeof apiModule = { exports: {} };
  const FixedDate = class extends Date {
    constructor() {
      super(now ?? 0);
    }
  };
  runInNewContext(apiSource, {
    module: moduleInstance,
    require: () => scheduleUtils,
    Date: now ? FixedDate : Date,
  });
  return moduleInstance.exports.getSchedule!;
}
const widgetApi = { getSchedule: loadGetSchedule() };

function makeHomey(available: boolean, domain: Record<string, unknown> | null) {
  const device = {
    getId: () => 'homey-device-1',
    getStoreValue: (key: string) => ({ hotWaterId: 1, hubId: 'hub-1' }[key as 'hotWaterId' | 'hubId']),
    capabilitiesObj: {},
  };
  const hub = {
    getHealth: () => ({ available }),
    getDomain: vi.fn(() => domain),
  };
  const homey = {
    drivers: { getDriver: () => ({ getDevices: () => [device] }) },
    app: { hubManager: { get: () => hub } },
    clock: { getTimezone: vi.fn(async () => 'Europe/London') },
  };
  return { homey, hub };
}

describe('schedule widget API connection status', () => {
  it('does not present cached heating data when the hub is unavailable', async () => {
    const { homey, hub } = makeHomey(false, {
      HotWater: [{ id: 1, WaterHeatingState: 'On', ScheduleId: 3 }],
      Schedule: [{ id: 3, Monday: [630, -730] }],
    });

    const result = await widgetApi.getSchedule({ homey, params: { deviceId: 'homey-device-1' } });

    expect(result).toEqual({
      available: false, state: null, target: null, nextEvent: null, activeSlot: null, schedule: null,
    });
    expect(hub.getDomain).not.toHaveBeenCalled();
  });

  it('returns current heating state after the connection recovers', async () => {
    const { homey } = makeHomey(true, {
      HotWater: [{
        id: 1, WaterHeatingState: 'On', ScheduledWaterHeatingState: 'Off', ScheduleId: 3,
      }],
      Schedule: [{ id: 3, Monday: [630, -730] }],
    });

    const result = await widgetApi.getSchedule({ homey, params: { deviceId: 'homey-device-1' } });

    expect(result.available).toBe(true);
    expect(result.state).toBe(true);
    expect(result.target).toBe('Off');
    expect(result.schedule).toEqual([{
      day: 'Monday',
      slots: [
        { time: '06:30', state: 'On' }, { time: '07:30', state: 'Off' },
      ],
    }]);
  });

  it('uses the Homey timezone to find the next local schedule event', async () => {
    const { homey } = makeHomey(true, {
      HotWater: [{
        id: 1, WaterHeatingState: 'Off', ScheduledWaterHeatingState: 'On', ScheduleId: 3,
      }],
      Schedule: [{ id: 3, Monday: [630, -730, 1800] }],
    });

    const fixedGetSchedule = loadGetSchedule('2026-07-06T06:45:00Z');
    const result = await fixedGetSchedule({ homey, params: { deviceId: 'homey-device-1' } });

    expect(result.nextEvent).toBe('Today 18:00 (On)');
    expect(result.activeSlot).toEqual({ day: 'Monday', index: 1 });
    expect(result.target).toBe('On');
    expect(homey.clock.getTimezone).toHaveBeenCalledOnce();
  });

  it('keeps live state and schedule when timezone lookup fails', async () => {
    const { homey } = makeHomey(true, {
      HotWater: [{ id: 1, WaterHeatingState: 'On', ScheduleId: 3 }],
      Schedule: [{ id: 3, Monday: [630, -730] }],
    });
    homey.clock.getTimezone.mockRejectedValueOnce(new Error('clock unavailable'));

    const result = await widgetApi.getSchedule({ homey, params: { deviceId: 'homey-device-1' } });

    expect(result.available).toBe(true);
    expect(result.state).toBe(true);
    expect(result.nextEvent).toBe('Timezone unavailable');
    expect(result.activeSlot).toBeNull();
    expect(result.schedule).toBeTruthy();
  });

  it('does not consult the clock when no schedule is available', async () => {
    const { homey } = makeHomey(true, {
      HotWater: [{ id: 1, WaterHeatingState: 'On', ScheduleId: 3 }],
      Schedule: [],
    });

    const result = await widgetApi.getSchedule({ homey, params: { deviceId: 'homey-device-1' } });

    expect(result.available).toBe(true);
    expect(result.state).toBe(true);
    expect(result.nextEvent).toBeNull();
    expect(homey.clock.getTimezone).not.toHaveBeenCalled();
  });
});
