# Next Steps

## Current State

The HeatHub driver is feature-complete for a standalone app and app-store-ready.

## Planned Drivers

### 1. Room Driver

Create a device for each Wiser Room (`domain.Room[]`).

Data source: `WiserDomain.Room`

Capabilities:

- `measure_temperature` (current temperature)
- `target_temperature` (setpoint)
- `thermostat_mode` or custom capability for mode (Auto/Manual/Override)
- Custom capability for boost state

Actions:

- Set target temperature
- Set mode (Auto/Manual)
- Boost
- Cancel override

Pairing:

- The hub already has all room data. Pairing can enumerate rooms and add them as child devices.
- Consider pairing via the hub device or as a separate driver that discovers rooms from the hub.

### 2. iTRV Driver

Create a device for each Wiser iTRV (`domain.Device[].ProductType === 'iTRV'`).

Data source: `WiserDomain.Device` combined with `WiserDomain.Room`

Capabilities:

- `measure_temperature`
- `target_temperature`
- `measure_battery`
- `measure_signal`
- Custom capability for valve position

### 3. RoomStat Driver

Create a device for each Wiser RoomStat.

Similar to iTRV but wall-mounted and may include humidity.

### 4. HotWater Driver

Create a device for each hot water cylinder (`domain.HotWater[]`).

Capabilities:

- `onoff` or custom capability for hot water state
- Custom capability for boost
- `measure_temperature` if available

Actions:

- Boost hot water
- Set mode
- Cancel override

## Suggested Implementation Order

1. Room driver (most useful, maps directly to `WiserDomain.Room`)
2. HotWater driver (small, single data source)
3. iTRV driver
4. RoomStat driver

## Technical Considerations

- Each child device should register as a listener on the hub's `WiserHub` instance via `WiserHubManager`.
- Child devices should not create their own polling loops; they receive domain updates from the hub.
- The `data.id` for each child device must be unique and stable (e.g., room ID, device ID, hot water ID).
- Use `onInit` to fetch the latest domain from the hub manager and set initial capability values.
- Use the `onPoll` listener pattern from `HubDevice` as a reference.

## Other Improvements

- **Repair flow**: allow users to update the hub secret or IP without deleting the device.
- **Manual refresh capability**: a button or Flow action to force a poll now.
- **Insights**: expose signal strength, heating active hours, away mode toggles.
- **Flow cards**: triggers for heating active, away mode changes; actions for boost, away mode.
- **Settings**: allow users to configure which rooms/devices are exposed.

## Hub Manager API

The `WiserHubManager` in `lib/wiser-hub-manager.ts` is the central point for accessing hub data from child devices.

```typescript
const manager = (this.homey.app as HubApp).hubManager;
const hub = manager.getHub(hubId);
const domain = hub.getDomain();
```

Child devices need to know their hub ID. This can be stored in `store.hubId` during pairing.
