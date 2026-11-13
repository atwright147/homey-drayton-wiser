import { describe, expect, it } from 'vitest';
import { getRoomStatReadings } from '../lib/wiser-roomstat';
import type { WiserDomain } from '../lib/wiser-types';
import fixture from './fixtures/domain.json';

function domain(overrides: Partial<WiserDomain> = {}): WiserDomain {
  return {
    Device: [{ id: 42, ProductType: 'RoomStat' }],
    RoomStat: [{ id: 42, MeasuredTemperature: 215, MeasuredHumidity: 48 }],
    Room: [{ id: 9, Name: 'Office', RoomStatId: 42 }],
    ...overrides,
  };
}

describe('RoomStat mapping', () => {
  it('maps the real sanitized hub fixture', () => {
    expect(getRoomStatReadings(fixture as WiserDomain, 1)).toEqual({
      id: 1,
      name: 'Master Bedroom RoomStat',
      temperature: 25.3,
      humidity: 58,
      battery: 100,
      signal: 48,
      offline: false,
    });
  });

  it('joins physical and measurement IDs independently of room IDs and supports unassigned devices', () => {
    expect(getRoomStatReadings(domain(), 42)).toMatchObject({ name: 'Office RoomStat', temperature: 21.5 });
    expect(getRoomStatReadings(domain({ Room: [{ id: 42, RoomStatId: 99, Name: 'Wrong room' }] }), 42)?.name).toBe('RoomStat 42');
    expect(getRoomStatReadings(domain({ Device: [{ id: 42, ProductType: 'iTRV' }] }), 42)).toBeNull();
    expect(getRoomStatReadings(domain({ RoomStat: [{ id: 99 }] }), 42)).toBeNull();
    expect(getRoomStatReadings(domain({ Device: [] }), 42)).toBeNull();
  });

  it.each([undefined, 2000, -32768, -200, NaN, Infinity])('clears invalid temperature %s', (value) => {
    expect(getRoomStatReadings(domain({ RoomStat: [{ id: 42, MeasuredTemperature: value }] }), 42)?.temperature).toBeNull();
  });

  it.each([undefined, -1, 101, NaN, Infinity])('clears invalid humidity %s', (value) => {
    expect(getRoomStatReadings(domain({ RoomStat: [{ id: 42, MeasuredHumidity: value }] }), 42)?.humidity).toBeNull();
  });

  it('preserves valid zero readings and maps voltage before coarse battery levels', () => {
    const readings = getRoomStatReadings(domain({
      Device: [{
        id: 42, ProductType: 'RoomStat', BatteryVoltage: 22, BatteryLevel: 'Normal',
      }],
      RoomStat: [{ id: 42, MeasuredTemperature: 0, MeasuredHumidity: 0 }],
    }), 42);
    expect(readings).toMatchObject({
      temperature: 0, humidity: 0, battery: 50, signal: null,
    });
  });

  it.each([undefined, 0, -1, NaN, Infinity])('falls back from invalid voltage %s to the reported battery level', (voltage) => {
    expect(getRoomStatReadings(domain({
      Device: [{
        id: 42, ProductType: 'RoomStat', BatteryVoltage: voltage, BatteryLevel: 'Low',
      }],
    }), 42)?.battery).toBe(20);
    expect(getRoomStatReadings(domain(), 42)?.battery).toBeNull();
  });

  it('uses the available RSSI direction then displayed strength, without inventing missing signal values', () => {
    const device = { id: 42, ProductType: 'RoomStat', DisplayedSignalStrength: 'Good' };
    expect(getRoomStatReadings(domain({ Device: [device] }), 42)?.signal).toBe(80);
    expect(getRoomStatReadings(domain({ Device: [{ ...device, ReceptionOfDevice: { Rssi: NaN }, ReceptionOfController: { Rssi: -75 } }] }), 42)?.signal).toBe(50);
    expect(getRoomStatReadings(domain({ Device: [{ ...device, DisplayedSignalStrength: 'Offline', ReceptionOfDevice: { Rssi: -50 } }] }), 42))
      .toMatchObject({ signal: 0, offline: true });
    expect(getRoomStatReadings(domain(), 42)?.signal).toBeNull();
  });
});
