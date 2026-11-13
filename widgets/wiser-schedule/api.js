'use strict';

const { formatNextHotWaterEvent, formatScheduleTime } = require('../../lib/wiser-utils');

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

module.exports = {
  async getSchedule({ homey, params }) {
    const deviceId = params.deviceId;
    if (!deviceId) {
      throw new Error('No device selected');
    }

    const driver = homey.drivers.getDriver('hotwater');
    const device = driver.getDevices().find((d) => d.getId() === deviceId);
    if (!device) {
      throw new Error('Device not found');
    }

    const hotWaterId = device.getStoreValue('hotWaterId');
    const hubId = device.getStoreValue('hubId');

    const manager = homey.app.hubManager;
    const hub = manager.get(hubId);
    if (!hub || !hub.getHealth().available) {
      return { available: false, state: null, nextEvent: null, schedule: null };
    }
    const domain = hub.getDomain();

    if (!domain) {
      return { available: false, state: null, nextEvent: null, schedule: null };
    }

    const hotWater = domain.HotWater?.find((hw) => hw.id === hotWaterId);
    const schedule = domain.Schedule?.find((s) => s.id === hotWater?.ScheduleId);

    const state = hotWaterState(hotWater);
    let nextEvent = null;
    if (schedule) {
      try {
        const timeZone = await homey.clock.getTimezone();
        if (!timeZone) throw new Error('Homey timezone is empty');
        nextEvent = formatNextHotWaterEvent(schedule, undefined, timeZone);
      } catch {
        nextEvent = 'Timezone unavailable';
      }
    }

    return {
      available: true,
      state,
      nextEvent,
      schedule: schedule ? buildScheduleView(schedule) : null,
    };
  },
};

function hotWaterState(hotWater) {
  if (!hotWater) return null;
  if (hotWater.WaterHeatingState === 'On') return true;
  if (hotWater.WaterHeatingState === 'Off') return false;
  if (hotWater.HotWaterRelayState === 'On') return true;
  if (hotWater.HotWaterRelayState === 'Off') return false;
  return null;
}

function scheduleDaySlots(dayData) {
  if (!Array.isArray(dayData)) return [];
  const slots = [];
  for (const value of dayData) {
    if (typeof value !== 'number') continue;
    const time = Math.abs(value);
    if (time >= 2400) continue;
    const state = value >= 0 ? 'On' : 'Off';
    slots.push({ time, state });
  }
  return slots;
}

function buildScheduleView(schedule) {
  const result = [];
  for (const day of DAY_NAMES) {
    const slots = scheduleDaySlots(schedule[day]);
    if (slots.length > 0) {
      result.push({ day, slots: slots.map((slot) => ({
        time: formatScheduleTime(slot.time), state: slot.state,
      })) });
    }
  }
  return result;
}
