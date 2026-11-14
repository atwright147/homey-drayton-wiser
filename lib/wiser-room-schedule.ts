import type { WiserSchedule } from './wiser-types';
import { validTemperatureFromApi } from './wiser-utils';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export interface RoomScheduleSlot {
  time: string;
  temperature: number | null;
  label: string;
  minutes: number;
}

export interface RoomScheduleDay {
  day: string;
  slots: RoomScheduleSlot[];
}

function timeMinutes(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null;
  const hours = Math.floor(value / 100);
  const minutes = value % 100;
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

function slot(time: unknown, degrees: unknown): RoomScheduleSlot | null {
  const minutes = timeMinutes(time);
  if (minutes === null || typeof degrees !== 'number' || !Number.isFinite(degrees)) return null;
  const temperature = validTemperatureFromApi(degrees);
  if (temperature === null && degrees !== -200) return null;
  const clock = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  return {
    time: clock, temperature, label: temperature === null ? 'Off' : `${temperature} °C`, minutes,
  };
}

function daySlots(value: unknown): RoomScheduleSlot[] {
  if (!value || typeof value !== 'object') return [];
  const day = value as Record<string, unknown>;
  let slots: RoomScheduleSlot[] = [];
  if (Array.isArray(day.SetPoints)) {
    slots = day.SetPoints.map((item: unknown) => {
      const point = item as Record<string, unknown> | null;
      return point ? slot(point.Time, point.DegreesC) : null;
    }).filter((item): item is RoomScheduleSlot => item !== null);
  } else if (Array.isArray(day.Time) && Array.isArray(day.DegreesC)) {
    slots = day.Time.map((time: unknown, index: number) => slot(time, (day.DegreesC as unknown[])[index]))
      .filter((item): item is RoomScheduleSlot => item !== null);
  }
  return slots.sort((a, b) => a.minutes - b.minutes);
}

export function roomScheduleDays(schedule: WiserSchedule): RoomScheduleDay[] {
  const source = schedule as unknown as Record<string, unknown>;
  return DAYS.map((day) => ({ day, slots: daySlots(source[day]) })).filter((day) => day.slots.length > 0);
}

export function nextRoomScheduleEvent(schedule: WiserSchedule, now: Date, timeZone: string): string | null {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const dayName = parts.find((part) => part.type === 'weekday')?.value ?? '';
  const dayIndex = DAYS.indexOf(dayName);
  if (dayIndex < 0) return null;
  const currentMinutes = Number(parts.find((part) => part.type === 'hour')?.value ?? 0) * 60
    + Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
  const source = schedule as unknown as Record<string, unknown>;
  for (let offset = 0; offset <= 7; offset++) {
    const day = DAYS[(dayIndex + offset) % 7];
    for (const point of daySlots(source[day])) {
      if (offset === 0 && point.minutes <= currentMinutes) continue;
      let label = day;
      if (offset === 0) label = 'Today';
      else if (offset === 1) label = 'Tomorrow';
      return `${label} ${point.time} (${point.label})`;
    }
  }
  return null;
}
