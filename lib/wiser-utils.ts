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
