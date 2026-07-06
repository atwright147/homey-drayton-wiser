export interface WiserBoilerSettings {
  ControlType: string;
  FuelType: string;
  CycleRate: string;
  OnOffHysteresis: number;
}

export interface WiserGeoPosition {
  Latitude: number;
  Longitude: number;
}

export interface WiserLocalDateAndTime {
  Year: number;
  Month: string;
  Date: number;
  Day: string;
  Time: number;
}

export interface WiserSystem {
  PairingStatus?: string;
  TimeZoneOffset?: number;
  AutomaticDaylightSummertime?: boolean;
  AutomaticDaylightSaving?: boolean;
  SystemMode?: string;
  FotaEnabled?: boolean;
  ValveProtectionEnabled?: boolean;
  AwayModeAffectsHotWater?: boolean;
  AwayModeSetPointLimit?: number;
  AwayMode?: boolean;
  BoilerSettings?: WiserBoilerSettings;
  CoolingModeDefaultSetpoint?: number;
  CoolingAwayModeSetpointLimit?: number;
  ComfortModeEnabled?: boolean;
  PreheatTimeLimit?: number;
  DegradedModeSetpointThreshold?: number;
  GeoPosition?: WiserGeoPosition;
  UfhOrphanModeOutput?: string;
  isMigrated?: boolean;
  UnixTime?: number;
  ActiveSystemVersion?: string;
  BrandName?: string;
  CloudConnectionStatus?: string;
  ChipId?: string;
  LocalDateAndTime?: WiserLocalDateAndTime;
  HeatingButtonOverrideState?: string;
  HotWaterButtonOverrideState?: string;
  OpenThermConnectionStatus?: string;
  SunriseTimes?: number[];
  SunsetTimes?: number[];
  isTrialist?: boolean;
  isProvisioned?: boolean;
  HardwareGeneration?: number;
}

export interface WiserBlockPublishing {
  [key: string]: boolean;
}

export interface WiserCloud {
  DetailedPublishing?: boolean;
  EnableFullScheduleTelemetry?: boolean;
  BlockPublishing?: WiserBlockPublishing;
  WiserApiHost?: string;
  BootStrapApiHost?: string;
}

export interface WiserHeatingChannel {
  id: number;
  Name?: string;
  RoomIds?: number[];
  PercentageDemand?: number;
  DemandOnOffOutput?: string;
  HeatingRelayState?: string;
  IsSmartValvePreventingDemand?: boolean;
}

export interface WiserHotWater {
  id: number;
  OverrideWaterHeatingState?: string;
  ScheduleId?: number;
  Mode?: string;
  AwayModeSuppressed?: boolean;
  WaterHeatingState?: string;
  ScheduledWaterHeatingState?: string;
  HotWaterRelayState?: string;
  HotWaterDescription?: string;
}

export interface WiserRoom {
  id: number;
  ScheduleId?: number;
  HeatingRate?: number;
  RoomStatId?: number;
  SmartValveIds?: number[];
  Name?: string;
  Mode?: string;
  DemandType?: string;
  WindowDetectionActive?: boolean;
  WindowState?: string;
  CalculatedTemperature?: number;
  CurrentSetPoint?: number;
  PercentageDemand?: number;
  ControlOutputState?: string;
  SetpointOrigin?: string;
  DisplayedSetPoint?: number;
  ScheduledSetPoint?: number;
  AwayModeSuppressed?: boolean;
  RoundedAlexaTemperature?: number;
  EffectiveMode?: string;
  PercentageDemandForItrv?: number;
  ControlDirection?: string;
  HeatingType?: string;
  RequestOverride?: {
    Type?: string;
    SetPoint?: number;
    DurationMinutes?: number;
  };
}

export interface WiserReception {
  Rssi?: number;
  Lqi?: number;
}

export interface WiserDevice {
  id: number;
  NodeId?: number;
  ProductType?: string;
  ProductIdentifier?: string;
  ActiveFirmwareVersion?: string;
  ModelIdentifier?: string;
  SerialNumber?: string;
  ProductModel?: string;
  OtaImageQueryCount?: number;
  LastOtaImageQueryCount?: number;
  ParentNodeId?: number;
  OtaVersion?: number;
  OtaHardwareVersion?: number;
  DeviceLockEnabled?: boolean;
  DisplayedSignalStrength?: string;
  BatteryVoltage?: number;
  BatteryLevel?: string;
  ReceptionOfController?: WiserReception;
  ReceptionOfDevice?: WiserReception;
  BindingsStatus?: string;
  ReportConfigStatus?: string;
}

export interface WiserZigbee {
  JPANCount?: number;
  NetworkChannel?: number;
  ZigbeeModuleVersion?: string;
  ZigbeeEUI?: string;
}

export interface WiserRoomStat {
  id: number;
  SetPoint?: number;
  MeasuredTemperature?: number;
  MeasuredHumidity?: number;
}

export interface WiserSmartValve {
  id: number;
  SetPoint?: number;
  MeasuredTemperature?: number;
  PercentageDemand?: number;
  WindowState?: string;
  BatteryVoltage?: number;
  BatteryLevel?: string;
}

export interface WiserDeviceCapabilityMatrix {
  Roomstat?: boolean;
  ITRV?: boolean;
  SmartPlug?: boolean;
  UFH?: boolean;
  UFHFloorTempSensor?: boolean;
  UFHDewSensor?: boolean;
  HACT?: boolean;
  LACT?: boolean;
  Light?: boolean;
  Shutter?: boolean;
  LoadController?: boolean;
}

export interface WiserSchedule {
  id: number;
  Type?: string;
  Name?: string;
  Monday?: unknown;
  Tuesday?: unknown;
  Wednesday?: unknown;
  Thursday?: unknown;
  Friday?: unknown;
  Saturday?: unknown;
  Sunday?: unknown;
}

export interface WiserMoment {
  id: number;
  Name?: string;
  Description?: string;
  Mode?: string;
}

export interface WiserDomain {
  System?: WiserSystem;
  Cloud?: WiserCloud;
  HeatingChannel?: WiserHeatingChannel[];
  HotWater?: WiserHotWater[];
  Room?: WiserRoom[];
  Device?: WiserDevice[];
  Zigbee?: WiserZigbee;
  RoomStat?: WiserRoomStat[];
  SmartValve?: WiserSmartValve[];
  Schedule?: WiserSchedule[];
  Moment?: WiserMoment[];
  DeviceCapabilityMatrix?: WiserDeviceCapabilityMatrix;
}

export type WiserNetwork = Record<string, unknown>;
