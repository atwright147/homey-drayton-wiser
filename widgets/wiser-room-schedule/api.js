'use strict';

const { roomScheduleDays, nextRoomScheduleEvent, activeRoomScheduleSlot } = require('../../lib/wiser-room-schedule');
const { validTemperatureFromApi } = require('../../lib/wiser-utils');

const unavailable = () => ({ available: false, name: null, state: null, target: null, nextEvent: null, activeSlot: null, schedule: null });

module.exports = {
  async getSchedule({ homey, params }) {
    if (!params.deviceId) throw new Error('No device selected');
    const device = homey.drivers.getDriver('room').getDevices().find((item) => item.getId() === params.deviceId);
    if (!device) throw new Error('Device not found');
    const hub = homey.app.hubManager.get(device.getStoreValue('hubId'));
    if (!hub || !hub.getHealth().available) return unavailable();
    const domain = hub.getDomain();
    if (!domain) return unavailable();
    const room = domain.Room?.find((item) => item.id === device.getStoreValue('roomId'));
    if (!room) return unavailable();
    let state = null;
    if (room.ControlOutputState === 'On') state = true;
    else if (room.ControlOutputState === 'Off') state = false;
    else if (typeof room.PercentageDemand === 'number' && Number.isFinite(room.PercentageDemand)
      && room.PercentageDemand >= 0 && room.PercentageDemand <= 100) {
      state = room.PercentageDemand > 0;
    }
    const schedule = domain.Schedule?.find((item) => item.id === room.ScheduleId && (item.Type == null || item.Type === 'Heating'));
    let nextEvent = null;
    let activeSlot = null;
    if (schedule) {
      try {
        const timeZone = await homey.clock.getTimezone();
        if (!timeZone) throw new Error('Homey timezone is empty');
        const now = new Date();
        nextEvent = nextRoomScheduleEvent(schedule, now, timeZone);
        activeSlot = activeRoomScheduleSlot(schedule, now, timeZone);
      } catch {
        nextEvent = 'Timezone unavailable';
      }
    }
    if (hub.getDomain() !== domain || !hub.getHealth().available) return unavailable();
    return {
      available: true,
      name: room.Name ?? device.getName(),
      state,
      target: validTemperatureFromApi(room.CurrentSetPoint ?? room.ScheduledSetPoint),
      nextEvent,
      activeSlot,
      schedule: schedule ? roomScheduleDays(schedule) : null,
    };
  },
};
