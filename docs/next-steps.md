# Next Steps

## Current State

The HeatHub driver is feature-complete for a standalone app and app-store-ready.
The Room driver is implemented and exposes temperature, target temperature, humidity, and mode for each Wiser Room.

## Planned Drivers

### 1. iTRV Driver

Create a device for each Wiser iTRV (`domain.Device[].ProductType === 'iTRV'`).

Data source: `WiserDomain.Device` combined with `WiserDomain.Room`

Capabilities:

- `measure_temperature`
- `target_temperature`
- `measure_battery`
- `measure_signal`
- Custom capability for valve position

### 2. RoomStat Driver

Create a device for each Wiser RoomStat.

Similar to iTRV but wall-mounted and may include humidity.

### 3. HotWater Driver

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

1. HotWater driver (small, single data source)
2. iTRV driver
3. RoomStat driver

## Technical Considerations

- Each child device should register as a listener on the hub's `WiserHub` instance via `WiserHubManager` (the Room driver already does this).
- Child devices should not create their own polling loops; they receive domain updates from the hub.
- The `data.id` for each child device must be unique and stable (e.g., room ID, device ID, hot water ID).
- Use `onInit` to fetch the latest domain from the hub manager and set initial capability values.
- Use the `onPoll` listener pattern from `RoomDevice` and `HubDevice` as a reference.

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
