import {
  describe, expect, it, vi,
} from 'vitest';
import widgetApi from '../widgets/wiser-schedule/api';

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
      available: false, state: null, nextEvent: null, schedule: null,
    });
    expect(hub.getDomain).not.toHaveBeenCalled();
  });

  it('returns current heating state after the connection recovers', async () => {
    const { homey } = makeHomey(true, {
      HotWater: [{ id: 1, WaterHeatingState: 'On', ScheduleId: 3 }],
      Schedule: [{ id: 3, Monday: [630, -730] }],
    });

    const result = await widgetApi.getSchedule({ homey, params: { deviceId: 'homey-device-1' } });

    expect(result.available).toBe(true);
    expect(result.state).toBe(true);
    expect(result.schedule).toEqual([{
      day: 'Monday',
      slots: [
        { time: 630, state: 'On' }, { time: 730, state: 'Off' },
      ],
    }]);
  });
});
