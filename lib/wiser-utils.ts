import type { WiserSchedule } from './wiser-types';

export const TEMP_ERROR = 2000;
export const TEMP_SENSOR_FAULT = -32768;
export const TEMP_OFF = -200;
export const TEMP_MINIMUM = 5;
export const TEMP_MAXIMUM = 30;
export const HW_TEMP_ON = 1100;
export const HW_TEMP_OFF = -200;
export const MAX_BOOST_DELTA = 5;

export type RoomMode = 'auto' | 'manual' | 'off';
export type HotWaterMode = 'auto' | 'on' | 'off';
export type BinaryMode = 'on' | 'off';

export function toApiTemp(celsius: number): number {
  return Math.round(celsius * 10);
}

export function toApiBoostDelta(celsius: number): number {
  return Math.max(0, Math.min(MAX_BOOST_DELTA, celsius)) * 10;
}

export function fromApiTemp(apiTemp: number): number | null {
  if (apiTemp === TEMP_ERROR || apiTemp === TEMP_SENSOR_FAULT) return null;
  return apiTemp / 10;
}

export function validTemperatureFromApi(apiTemp?: number): number | null {
  if (apiTemp == null || apiTemp === TEMP_ERROR || apiTemp === TEMP_OFF || apiTemp === TEMP_SENSOR_FAULT) {
    return null;
  }
  return apiTemp / 10;
}

export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function batteryPercentFromVoltage(voltage: number, fullV: number, minV: number): number {
  const realVolts = voltage / 10;
  const percent = ((realVolts - minV) / (fullV - minV)) * 100;
  return clamp(Math.round(percent), 0, 100);
}

export function trvBatteryPercent(voltage: number): number {
  return batteryPercentFromVoltage(voltage, 3.0, 2.4);
}

export function roomstatBatteryPercent(voltage: number): number {
  return batteryPercentFromVoltage(voltage, 2.7, 1.7);
}

export function batteryPercentFromLevel(level: string): number | null {
  switch (level) {
    case 'Normal': return 100;
    case 'Low': return 20;
    case 'OneThird': return 33;
    case 'TwoThirds': return 66;
    default: return null;
  }
}

export function signalPercentFromRssi(rssi: number): number {
  if (rssi >= -50) return 100;
  if (rssi <= -100) return 0;
  return clamp(Math.round(((rssi + 100) / 50) * 100), 0, 100);
}

export function signalPercentFromDisplayed(strength: string): number | null {
  switch (strength) {
    case 'VeryGood': return 100;
    case 'Good': return 80;
    case 'Medium': return 60;
    case 'Poor': return 30;
    case 'NoSignal': return 0;
    case 'Offline': return 0;
    default: return null;
  }
}

export function booleanFromWiser(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'on' || normalized === 'yes') {
      return true;
    }
    if (normalized === 'false' || normalized === '0' || normalized === 'off' || normalized === 'no') {
      return false;
    }
  }
  return false;
}

export function binaryModeFromBoolean(value: boolean): BinaryMode {
  return value ? 'on' : 'off';
}

export function binaryModeToBoolean(value: string): boolean {
  return value === 'on';
}

export function roomModeToWiser(mode: RoomMode): string {
  if (mode === 'auto') return 'Auto';
  if (mode === 'manual') return 'Manual';
  return 'Off';
}

export function roomModeFromWiser(mode: string): RoomMode | null {
  if (mode === 'Auto') return 'auto';
  if (mode === 'Manual') return 'manual';
  if (mode === 'Off') return 'off';
  return null;
}

export function hotWaterModeToWiser(mode: HotWaterMode): string {
  if (mode === 'auto') return 'Auto';
  if (mode === 'on') return 'On';
  return 'Off';
}

export function hotWaterModeFromWiser(mode: string): HotWaterMode | null {
  if (mode === 'Auto') return 'auto';
  if (mode === 'On') return 'on';
  if (mode === 'Off') return 'off';
  return null;
}

export interface HotWaterScheduleEvent {
  day: string;
  time: string;
  state: 'On' | 'Off';
}

export interface ActiveHotWaterScheduleSlot {
  day: string;
  index: number;
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function scheduleDaySlots(dayData: unknown): Array<{ time: number; state: 'On' | 'Off' }> {
  if (!Array.isArray(dayData)) return [];
  const slots: Array<{ time: number; state: 'On' | 'Off' }> = [];
  for (const value of dayData) {
    if (typeof value !== 'number') continue;
    const time = Math.abs(value);
    if (time >= 2400) continue;
    const state = value >= 0 ? 'On' : 'Off';
    slots.push({ time, state });
  }
  return slots;
}

export function flattenScheduleResponse(body: Record<string, unknown>): WiserSchedule[] {
  const result: WiserSchedule[] = [];
  for (const value of Object.values(body)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object' && 'id' in item) {
          result.push(item as WiserSchedule);
        }
      }
    } else if (value && typeof value === 'object' && 'id' in value) {
      result.push(value as WiserSchedule);
    }
  }
  return result;
}

export function formatScheduleTime(timeValue: number): string {
  const hours = Math.floor(timeValue / 100);
  const minutes = timeValue % 100;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

function scheduleDayName(offset: number, dayName: string): string {
  if (offset === 0) return 'Today';
  if (offset === 1) return 'Tomorrow';
  return dayName;
}

function currentScheduleTime(now: Date, timeZone: string): { dayIndex: number; minutes: number } {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(now);
  const dayName = parts.find((part) => part.type === 'weekday')?.value ?? '';
  const hours = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minutes = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
  return { dayIndex: DAY_NAMES.indexOf(dayName), minutes: hours * 60 + minutes };
}

function relativeDayName(dayName: string, currentDayIndex: number): string {
  const dayIndex = DAY_NAMES.indexOf(dayName);
  if (dayIndex === -1) return dayName;

  if (dayIndex === currentDayIndex) return 'Today';
  if (dayIndex === (currentDayIndex + 1) % 7) return 'Tomorrow';
  return dayName;
}

export function activeHotWaterScheduleSlot(
  schedule: WiserSchedule | undefined,
  now: Date,
  timeZone = 'UTC',
): ActiveHotWaterScheduleSlot | null {
  if (!schedule) return null;
  const current = currentScheduleTime(now, timeZone);
  if (current.dayIndex < 0) return null;
  const source = schedule as unknown as Record<string, unknown>;
  for (let offset = 0; offset < 7; offset++) {
    const day = DAY_NAMES[(current.dayIndex - offset + 7) % 7];
    const slots = scheduleDaySlots(source[day]);
    let latestIndex = -1;
    let latestMinutes = -1;
    slots.forEach((slot, index) => {
      const minutes = Math.floor(slot.time / 100) * 60 + (slot.time % 100);
      if ((offset > 0 || minutes <= current.minutes) && minutes >= latestMinutes) {
        latestIndex = index;
        latestMinutes = minutes;
      }
    });
    if (latestIndex >= 0) return { day, index: latestIndex };
  }
  return null;
}

export function nextHotWaterEvent(
  schedule: WiserSchedule | undefined,
  now?: Date,
  timeZone = 'UTC',
): HotWaterScheduleEvent | null {
  if (!schedule) return null;
  const reference = now ?? new Date();
  const current = currentScheduleTime(reference, timeZone);

  if (schedule.Next?.Time != null && schedule.Next.Day != null && schedule.Next.State != null) {
    return {
      day: relativeDayName(schedule.Next.Day, current.dayIndex),
      time: formatScheduleTime(schedule.Next.Time),
      state: schedule.Next.State as 'On' | 'Off',
    };
  }

  for (let offset = 0; offset <= 7; offset++) {
    const dayName = DAY_NAMES[(current.dayIndex + offset) % 7];
    const slots = scheduleDaySlots((schedule as unknown as Record<string, unknown>)[dayName]);
    for (const slot of slots) {
      const slotMinutes = Math.floor(slot.time / 100) * 60 + (slot.time % 100);
      if (offset === 0 && slotMinutes <= current.minutes) continue;
      return {
        day: scheduleDayName(offset, dayName),
        time: formatScheduleTime(slot.time),
        state: slot.state,
      };
    }
  }

  return null;
}

export function formatNextHotWaterEvent(schedule: WiserSchedule | undefined, now?: Date, timeZone = 'UTC'): string | null {
  const event = nextHotWaterEvent(schedule, now, timeZone);
  if (!event) return null;
  return `${event.day} ${event.time} (${event.state})`;
}
