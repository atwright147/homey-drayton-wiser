import { describe, it, expect } from 'vitest';
import {
  toApiTemp,
  fromApiTemp,
  validTemperatureFromApi,
  TEMP_ERROR,
  TEMP_OFF,
  batteryPercentFromVoltage,
  trvBatteryPercent,
  roomstatBatteryPercent,
  batteryPercentFromLevel,
  signalPercentFromRssi,
  signalPercentFromDisplayed,
  roomModeToWiser,
  roomModeFromWiser,
  hotWaterModeToWiser,
  hotWaterModeFromWiser,
} from '../lib/wiser-utils';

describe('toApiTemp', () => {
  it('converts celsius to API tenths', () => {
    expect(toApiTemp(20)).toBe(200);
    expect(toApiTemp(21.5)).toBe(215);
    expect(toApiTemp(5)).toBe(50);
    expect(toApiTemp(30)).toBe(300);
    expect(toApiTemp(22.55)).toBe(226);
  });
});

describe('fromApiTemp', () => {
  it('converts API tenths to celsius', () => {
    expect(fromApiTemp(200)).toBe(20);
    expect(fromApiTemp(253)).toBe(25.3);
    expect(fromApiTemp(0)).toBe(0);
  });
  it('returns null for TEMP_ERROR sentinel', () => {
    expect(fromApiTemp(TEMP_ERROR)).toBeNull();
  });
  it('returns the off value for TEMP_OFF', () => {
    expect(fromApiTemp(TEMP_OFF)).toBe(-20);
  });
});

describe('batteryPercentFromVoltage', () => {
  it('maps linearly and clamps', () => {
    expect(batteryPercentFromVoltage(30, 3.0, 2.4)).toBe(100);
    expect(batteryPercentFromVoltage(24, 3.0, 2.4)).toBe(0);
    expect(batteryPercentFromVoltage(27, 3.0, 2.4)).toBe(50);
    expect(batteryPercentFromVoltage(40, 3.0, 2.4)).toBe(100);
    expect(batteryPercentFromVoltage(20, 3.0, 2.4)).toBe(0);
  });
});

describe('trvBatteryPercent', () => {
  it('uses TRV thresholds (3.0V full, 2.4V empty)', () => {
    expect(trvBatteryPercent(30)).toBe(100);
    expect(trvBatteryPercent(24)).toBe(0);
    expect(trvBatteryPercent(27)).toBe(50);
  });
});

describe('roomstatBatteryPercent', () => {
  it('uses RoomStat thresholds (2.7V full, 1.7V empty)', () => {
    expect(roomstatBatteryPercent(27)).toBe(100);
    expect(roomstatBatteryPercent(17)).toBe(0);
    expect(roomstatBatteryPercent(30)).toBe(100);
    expect(roomstatBatteryPercent(22)).toBe(50);
  });
  it('matches the fixture value (BatteryVoltage 30)', () => {
    expect(roomstatBatteryPercent(30)).toBe(100);
  });
});

describe('batteryPercentFromLevel', () => {
  it('maps string levels', () => {
    expect(batteryPercentFromLevel('Normal')).toBe(100);
    expect(batteryPercentFromLevel('Low')).toBe(20);
    expect(batteryPercentFromLevel('OneThird')).toBe(33);
    expect(batteryPercentFromLevel('TwoThirds')).toBe(66);
    expect(batteryPercentFromLevel('Unknown')).toBeNull();
  });
});

describe('signalPercentFromRssi', () => {
  it('maps RSSI to percent', () => {
    expect(signalPercentFromRssi(-50)).toBe(100);
    expect(signalPercentFromRssi(-40)).toBe(100);
    expect(signalPercentFromRssi(-100)).toBe(0);
    expect(signalPercentFromRssi(-110)).toBe(0);
    expect(signalPercentFromRssi(-75)).toBe(50);
  });
});

describe('signalPercentFromDisplayed', () => {
  it('maps displayed strength strings', () => {
    expect(signalPercentFromDisplayed('VeryGood')).toBe(100);
    expect(signalPercentFromDisplayed('Good')).toBe(80);
    expect(signalPercentFromDisplayed('Medium')).toBe(60);
    expect(signalPercentFromDisplayed('Poor')).toBe(30);
    expect(signalPercentFromDisplayed('NoSignal')).toBe(0);
    expect(signalPercentFromDisplayed('Offline')).toBe(0);
    expect(signalPercentFromDisplayed('Unknown')).toBeNull();
  });
});

describe('validTemperatureFromApi', () => {
  it('converts API tenths to celsius', () => {
    expect(validTemperatureFromApi(200)).toBe(20);
    expect(validTemperatureFromApi(253)).toBe(25.3);
  });

  it('returns null for undefined', () => {
    expect(validTemperatureFromApi(undefined)).toBeNull();
  });

  it('returns null for TEMP_ERROR', () => {
    expect(validTemperatureFromApi(TEMP_ERROR)).toBeNull();
  });

  it('returns null for TEMP_OFF', () => {
    expect(validTemperatureFromApi(TEMP_OFF)).toBeNull();
  });
});

describe('roomMode mapping', () => {
  it('to wiser', () => {
    expect(roomModeToWiser('auto')).toBe('Auto');
    expect(roomModeToWiser('manual')).toBe('Manual');
    expect(roomModeToWiser('off')).toBe('Off');
  });
  it('from wiser', () => {
    expect(roomModeFromWiser('Auto')).toBe('auto');
    expect(roomModeFromWiser('Manual')).toBe('manual');
    expect(roomModeFromWiser('Off')).toBe('off');
    expect(roomModeFromWiser('Foo')).toBeNull();
  });
});

describe('hotWaterMode mapping', () => {
  it('to wiser', () => {
    expect(hotWaterModeToWiser('auto')).toBe('Auto');
    expect(hotWaterModeToWiser('on')).toBe('On');
    expect(hotWaterModeToWiser('off')).toBe('Off');
  });
  it('from wiser', () => {
    expect(hotWaterModeFromWiser('Auto')).toBe('auto');
    expect(hotWaterModeFromWiser('On')).toBe('on');
    expect(hotWaterModeFromWiser('Off')).toBe('off');
    expect(hotWaterModeFromWiser('Foo')).toBeNull();
  });
});
