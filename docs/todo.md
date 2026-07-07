# Implementation TODO

This document tracks features that exist in the Home Assistant Wiser integration but are not yet implemented in this Homey Pro app.

Items are grouped by area. The order within each group is not strict; pick according to the project roadmap in [next-steps.md](./next-steps.md).

## Hub / System

- [x] Comfort mode toggle
- [x] Eco mode toggle
- [ ] Daylight saving toggle
- [ ] Valve protection toggle
- [ ] Boost all rooms action
- [ ] Cancel all overrides action
- [ ] Away mode target temperature slider
- [ ] Heating mode sensor (Normal / Away)
- [ ] Heating channel demand percentage sensor
- [ ] Wi-Fi signal strength for the hub
- [ ] OpenTherm connection status sensor
- [ ] Expose more hub diagnostic attributes

## Rooms / Climate

- [x] Boost heating action (target temperature + duration) — Flow action `boost_room`
- [ ] Cancel boost / override action
- [ ] Advance schedule action
- [ ] Window detection control
- [ ] Per-room percentage demand sensor
- [ ] Long-term statistics sensors for target temp, current temp, and demand
- [ ] Events when a room starts or stops heating
- [ ] Number of iTRVs and locked-state attributes
- [ ] Roomstat lock state

## Hot Water

- [x] Boost hot water action (duration) — Flow action `boost_hot_water`
- [ ] Override hot water action
- [ ] Cancel hot water override action
- [ ] Hot water operation mode sensor (Auto / Manual / Boost / Override)
- [ ] External tank temperature sensor climate control

## Device Drivers

- [ ] iTRV driver
  - [ ] measure_temperature
  - [ ] target_temperature
  - [ ] measure_battery
  - [ ] measure_signal
  - [ ] valve position custom capability
  - [ ] device lock switch
  - [ ] identify switch
  - [ ] window state
- [ ] RoomStat driver
  - [ ] measure_temperature
  - [ ] measure_humidity
  - [ ] measure_battery
  - [ ] measure_signal
  - [ ] device lock switch
  - [ ] identify switch
- [ ] Heating actuator driver
- [ ] Underfloor heating controller driver
- [ ] Smart plug driver
  - [ ] on/off switch
  - [ ] mode selector (Auto / Manual)
  - [ ] power/energy sensors
  - [ ] away mode action switch
- [ ] Light driver
  - [ ] on/off
  - [ ] dimming
  - [ ] color control
  - [ ] mode selector (Auto / Manual)
  - [ ] schedule support
- [ ] Shutter / blind driver
  - [ ] position
  - [ ] tilt
  - [ ] mode selector (Auto / Manual)
  - [ ] schedule support
- [ ] PowerTag C / E power monitoring
- [ ] Button panel (Wiser Odace) support
- [ ] Window / door sensor support
- [ ] Smoke alarm sensor support

## Moments / Scenes

- [ ] Buttons to activate Wiser Moments

## Schedules

- [ ] Get schedule for rooms, hot water, lights, and shutters
- [ ] Set schedule for rooms, hot water, lights, and shutters
- [ ] Copy schedule between devices
- [ ] Assign / unassign schedule
- [ ] Schedule editor UI (widget or custom view)

## Services / Actions

- [x] `boost_heating` service/action — Flow action `boost_room`
- [x] `boost_hotwater` service/action — Flow action `boost_hot_water`
- [ ] `set_device_mode` for smart plugs, hot water, lights, and shutters
- [ ] `get_schedule` / `set_schedule` / `copy_schedule` / `assign_schedule`

## Automations

- [ ] Passive TRV emulation (heat room without firing boiler)

## Events

- [ ] `wiser_event` triggered on boosted, started_heating, and stopped_heating

## UI

- [ ] Zigbee network connectivity card
- [ ] Multi-hub support
- [ ] Device identify flow
- [ ] Repair flow to update hub secret or IP

## Infrastructure

- [x] Flow cards for boost actions
- [ ] Flow cards for triggers and other actions
- [ ] Insights and long-term statistics configuration
- [ ] Allow users to configure which rooms/devices are exposed
- [ ] Manual refresh action/Flow card

## Notes

- See [next-steps.md](./next-steps.md) for the original implementation plan and child-device architecture.
- This list is based on the Home Assistant Wiser integration as of v3.4.19. The HA integration also covers some European Schneider Electric Wiser devices (lights, blinds, shutters) which may not be applicable to every install.
