import type { WiserSchedule } from './wiser-types';

export const TEMP_ERROR = 2000;
export const TEMP_OFF = -200;
export const TEMP_MINIMUM = 5;
export const TEMP_MAXIMUM = 30;

export type RoomMode = 'auto' | 'manual' | 'off';
export type HotWaterMode = 'auto' | 'on' | 'off';

export function toApiTemp(celsius: number): number {
  return Math.round(celsius * 10);
}

export function fromApiTemp(apiTemp: number): number | null {
  if (apiTemp === TEMP_ERROR) return null;
  return apiTemp / 10;
}

export function validTemperatureFromApi(apiTemp?: number): number | null {
  if (apiTemp == null || apiTemp === TEMP_ERROR || apiTemp === TEMP_OFF) {
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

function relativeDayName(dayName: string, now?: Date): string {
  const reference = now ?? new Date();
  const currentDayIndex = reference.getDay();
  const dayIndex = DAY_NAMES.indexOf(dayName);
  if (dayIndex === -1) return dayName;

  const jsCurrentDayIndex = currentDayIndex === 0 ? 6 : currentDayIndex - 1;
  if (dayIndex === jsCurrentDayIndex) return 'Today';
  if (dayIndex === (jsCurrentDayIndex + 1) % 7) return 'Tomorrow';
  return dayName;
}

export function nextHotWaterEvent(schedule: WiserSchedule | undefined, now?: Date): HotWaterScheduleEvent | null {
  if (!schedule) return null;

  if (schedule.Next?.Time != null && schedule.Next.Day != null && schedule.Next.State != null) {
    return {
      day: relativeDayName(schedule.Next.Day, now),
      time: formatScheduleTime(schedule.Next.Time),
      state: schedule.Next.State as 'On' | 'Off',
    };
  }

  const reference = now ?? new Date();
  const currentDay = reference.getDay();
  const currentMinutes = reference.getHours() * 60 + reference.getMinutes();

  const orderedDays: string[] = [];
  for (let i = 0; i < 7; i++) {
    const dayIndex = (currentDay + i) % 7;
    const nameIndex = dayIndex === 0 ? 6 : dayIndex - 1;
    orderedDays.push(DAY_NAMES[nameIndex]);
  }

  for (let offset = 0; offset < 7; offset++) {
    const dayName = orderedDays[offset];
    const slots = scheduleDaySlots((schedule as unknown as Record<string, unknown>)[dayName]);
    for (const slot of slots) {
      const slotMinutes = Math.floor(slot.time / 100) * 60 + (slot.time % 100);
      if (offset === 0 && slotMinutes <= currentMinutes) continue;
      return {
        day: scheduleDayName(offset, dayName),
        time: formatScheduleTime(slot.time),
        state: slot.state,
      };
    }
  }

  return null;
}

export function formatNextHotWaterEvent(schedule: WiserSchedule | undefined, now?: Date): string | null {
  const event = nextHotWaterEvent(schedule, now);
  if (!event) return null;
  return `${event.day} ${event.time} (${event.state})`;
}
