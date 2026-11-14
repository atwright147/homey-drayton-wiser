import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import {
  describe, expect, it, vi,
} from 'vitest';
import { roomScheduleDays, nextRoomScheduleEvent } from '../lib/wiser-room-schedule';
import * as scheduleUtils from '../lib/wiser-room-schedule';
import * as wiserUtils from '../lib/wiser-utils';
import type { WiserSchedule } from '../lib/wiser-types';

const schedule = {
  id: 3,
  Monday: { Time: [630, 800, 1800], DegreesC: [210, 150, 200] },
  Tuesday: { SetPoints: [{ Time: 630, DegreesC: 215 }, { Time: 2230, DegreesC: -200 }] },
} as WiserSchedule;
const apiModule: { exports: { getSchedule?: (args: { homey: unknown; params: { deviceId: string } }) => Promise<Record<string, unknown>> } } = { exports: {} };
runInNewContext(readFileSync(join(process.cwd(), 'widgets/wiser-room-schedule/api.js'), 'utf8'), {
  module: apiModule,
  require: (name: string) => (name.includes('wiser-room-schedule') ? scheduleUtils : wiserUtils),
  Date,
});
const getSchedule = apiModule.exports.getSchedule!;

function makeHomey(domain: Record<string, unknown> | null, available = true) {
  const device = {
    getId: () => 'homey-room-1',
    getName: () => 'Room tile',
    getStoreValue: (key: string) => ({ hubId: 'hub-1', roomId: 9 })[key as 'hubId' | 'roomId'],
  };
  const hub = { getHealth: () => ({ available }), getDomain: vi.fn(() => domain) };
  const homey = {
    drivers: { getDriver: () => ({ getDevices: () => [device] }) },
    app: { hubManager: { get: () => hub } },
    clock: { getTimezone: vi.fn(async () => 'Europe/London') },
  };
  return { homey, hub };
}

describe('room schedule parsing', () => {
  it('renders live HHMM arrays and older SetPoints, including Off', () => {
    expect(roomScheduleDays(schedule)).toEqual([
      {
        day: 'Monday',
        slots: [
          {
            time: '06:30', temperature: 21, label: '21 °C', minutes: 390,
          },
          {
            time: '08:00', temperature: 15, label: '15 °C', minutes: 480,
          },
          {
            time: '18:00', temperature: 20, label: '20 °C', minutes: 1080,
          },
        ],
      },
      {
        day: 'Tuesday',
        slots: [
          {
            time: '06:30', temperature: 21.5, label: '21.5 °C', minutes: 390,
          },
          {
            time: '22:30', temperature: null, label: 'Off', minutes: 1350,
          },
        ],
      },
    ]);
  });

  it('rejects malformed slots and sorts remaining changes', () => {
    expect(roomScheduleDays({ id: 1, Monday: { Time: [1800, 2500, 390, 800], DegreesC: [200, 210, 2000, 150] } } as WiserSchedule))
      .toEqual([{
        day: 'Monday',
        slots: [
          {
            time: '08:00', temperature: 15, label: '15 °C', minutes: 480,
          },
          {
            time: '18:00', temperature: 20, label: '20 °C', minutes: 1080,
          },
        ],
      }]);
  });

  it('uses the Homey timezone, crosses days, and wraps the week', () => {
    expect(nextRoomScheduleEvent(schedule, new Date('2026-07-06T06:45:00Z'), 'Europe/London'))
      .toBe('Today 08:00 (15 °C)');
    expect(nextRoomScheduleEvent(schedule, new Date('2026-07-06T21:00:00Z'), 'Europe/London'))
      .toBe('Tomorrow 06:30 (21.5 °C)');
    expect(nextRoomScheduleEvent(schedule, new Date('2026-07-07T22:00:00Z'), 'Europe/London'))
      .toBe('Monday 06:30 (21 °C)');
  });
});

describe('room schedule widget API', () => {
  const domain = {
    Room: [{
      id: 9, Name: 'Office', ScheduleId: 3, ScheduledSetPoint: 200,
    }],
    Schedule: [schedule],
  };

  it('returns the selected room schedule and its next change without polling', async () => {
    const { homey, hub } = makeHomey(domain);
    const response = await getSchedule({ homey, params: { deviceId: 'homey-room-1' } });
    expect(response).toMatchObject({ available: true, name: 'Office', target: 20 });
    expect(response.nextEvent).toContain('°C');
    expect((response.schedule as unknown[]).length).toBe(2);
    expect(hub.getDomain).toHaveBeenCalledTimes(2);
  });

  it('hides cached data while the hub is unavailable or the room is missing', async () => {
    const unavailable = makeHomey(domain, false);
    expect(await getSchedule({ homey: unavailable.homey, params: { deviceId: 'homey-room-1' } }))
      .toEqual({
        available: false, name: null, target: null, nextEvent: null, schedule: null,
      });
    expect(unavailable.hub.getDomain).not.toHaveBeenCalled();
    const missing = makeHomey({ Room: [], Schedule: [schedule] });
    expect((await getSchedule({ homey: missing.homey, params: { deviceId: 'homey-room-1' } })).available).toBe(false);
  });

  it('keeps weekly slots when Homey timezone fails', async () => {
    const { homey } = makeHomey(domain);
    homey.clock.getTimezone.mockRejectedValueOnce(new Error('clock offline'));
    const response = await getSchedule({ homey, params: { deviceId: 'homey-room-1' } });
    expect(response.nextEvent).toBe('Timezone unavailable');
    expect(response.schedule).toBeTruthy();
  });

  it('uses only the room schedule ID and ignores a hot-water schedule with the same ID', async () => {
    const { homey } = makeHomey({ Room: [{ id: 9, ScheduleId: 3 }], Schedule: [{ id: 3, Type: 'HotWater', Monday: [630] }] });
    const response = await getSchedule({ homey, params: { deviceId: 'homey-room-1' } });
    expect(response.schedule).toBeNull();
    expect(homey.clock.getTimezone).not.toHaveBeenCalled();
  });
});
