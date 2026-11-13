'use strict';

const { roomScheduleDays, nextRoomScheduleEvent } = require('../../lib/wiser-room-schedule');
const { validTemperatureFromApi } = require('../../lib/wiser-utils');

const unavailable = () => ({ available: false, name: null, target: null, nextEvent: null, schedule: null });

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
    const schedule = domain.Schedule?.find((item) => item.id === room.ScheduleId && item.Type === 'Heating');
    let nextEvent = null;
    if (schedule) {
      try {
        const timeZone = await homey.clock.getTimezone();
        if (!timeZone) throw new Error('Homey timezone is empty');
        nextEvent = nextRoomScheduleEvent(schedule, new Date(), timeZone);
      } catch {
        nextEvent = 'Timezone unavailable';
      }
    }
    if (hub.getDomain() !== domain || !hub.getHealth().available) return unavailable();
    return {
      available: true,
      name: room.Name ?? device.getName(),
      target: validTemperatureFromApi(room.ScheduledSetPoint),
      nextEvent,
      schedule: schedule ? roomScheduleDays(schedule) : null,
    };
  },
};
