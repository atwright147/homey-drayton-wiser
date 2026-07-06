'use strict';

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
    const domain = hub?.getDomain();

    if (!domain) {
      return { state: null, nextEvent: null, schedule: null };
    }

    const hotWater = domain.HotWater?.find((hw) => hw.id === hotWaterId);
    const schedule = domain.Schedule?.find((s) => s.id === hotWater?.ScheduleId);

    const state = hotWaterState(hotWater);
    const nextEvent = nextEventFromSchedule(schedule) ?? device.capabilitiesObj?.wiser_hotwater_next_event?.value ?? null;

    return {
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

function nextEventFromSchedule(schedule, now) {
  if (!schedule) return null;

  if (schedule.Next?.Time != null && schedule.Next.Day != null && schedule.Next.State != null) {
    return `${relativeDayName(schedule.Next.Day, now)} ${formatScheduleTime(schedule.Next.Time)} (${schedule.Next.State})`;
  }

  const reference = now ?? new Date();
  const currentDay = reference.getDay();
  const currentMinutes = reference.getHours() * 60 + reference.getMinutes();

  const orderedDays = [];
  for (let i = 0; i < 7; i++) {
    const dayIndex = (currentDay + i) % 7;
    const nameIndex = dayIndex === 0 ? 6 : dayIndex - 1;
    orderedDays.push(DAY_NAMES[nameIndex]);
  }

  for (let offset = 0; offset < 7; offset++) {
    const dayName = orderedDays[offset];
    const slots = scheduleDaySlots(schedule[dayName]);
    for (const slot of slots) {
      const slotMinutes = Math.floor(slot.time / 100) * 60 + (slot.time % 100);
      if (offset === 0 && slotMinutes <= currentMinutes) continue;
      return `${dayLabel(offset, dayName)} ${formatScheduleTime(slot.time)} (${slot.state})`;
    }
  }

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

function formatScheduleTime(timeValue) {
  const hours = Math.floor(timeValue / 100);
  const minutes = timeValue % 100;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

function relativeDayName(dayName, now) {
  const reference = now ?? new Date();
  const currentDay = reference.getDay();
  const dayIndex = DAY_NAMES.indexOf(dayName);
  if (dayIndex === -1) return dayName;

  const currentIndex = currentDay === 0 ? 6 : currentDay - 1;
  if (dayIndex === currentIndex) return 'Today';
  if (dayIndex === (currentIndex + 1) % 7) return 'Tomorrow';
  return dayName;
}

function dayLabel(offset, dayName) {
  if (offset === 0) return 'Today';
  if (offset === 1) return 'Tomorrow';
  return dayName;
}

function buildScheduleView(schedule) {
  const result = [];
  for (const day of DAY_NAMES) {
    const slots = scheduleDaySlots(schedule[day]);
    if (slots.length > 0) {
      result.push({ day, slots });
    }
  }
  return result;
}
