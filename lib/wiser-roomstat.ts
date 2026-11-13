import type { WiserDomain } from './wiser-types';
import {
  batteryPercentFromLevel,
  roomstatBatteryPercent,
  signalPercentFromDisplayed,
  signalPercentFromRssi,
  validTemperatureFromApi,
} from './wiser-utils';

export interface RoomStatReadings {
  id: number;
  name: string;
  temperature: number | null;
  humidity: number | null;
  battery: number | null;
  signal: number | null;
  offline: boolean;
}

export function getRoomStatReadings(domain: WiserDomain, id: number): RoomStatReadings | null {
  const device = domain.Device?.find((item) => item.id === id && item.ProductType === 'RoomStat');
  const stat = domain.RoomStat?.find((item) => item.id === id);
  if (!device || !stat) return null;
  const room = domain.Room?.find((item) => item.RoomStatId === id);
  const temperature = Number.isFinite(stat.MeasuredTemperature) ? validTemperatureFromApi(stat.MeasuredTemperature) : null;
  const humidity = stat.MeasuredHumidity;
  const voltage = device.BatteryVoltage;
  const battery = voltage != null && Number.isFinite(voltage) && voltage > 0
    ? roomstatBatteryPercent(voltage) : batteryPercentFromLevel(device.BatteryLevel ?? '');
  const rssi = [device.ReceptionOfDevice?.Rssi, device.ReceptionOfController?.Rssi]
    .find((value) => value != null && Number.isFinite(value) && value < 0);
  const offline = device.DisplayedSignalStrength === 'Offline';
  let signal = rssi != null ? signalPercentFromRssi(rssi)
    : signalPercentFromDisplayed(device.DisplayedSignalStrength ?? '');
  if (offline || device.DisplayedSignalStrength === 'NoSignal') signal = 0;
  return {
    id,
    name: room?.Name ? `${room.Name} RoomStat` : `RoomStat ${id}`,
    temperature,
    humidity: humidity != null && Number.isFinite(humidity) && humidity >= 0 && humidity <= 100 ? humidity : null,
    battery,
    signal,
    offline,
  };
}
