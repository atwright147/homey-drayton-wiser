# Next Steps

## Current State

The HeatHub driver pairs via mDNS or manual IP, verifies discovered address changes against its ChipId, and owns the polling hub shared by child devices. Its availability follows poll health; the dashboard widget hides stale data while the hub is unavailable.
The Room driver is implemented and exposes temperature, target temperature, humidity, and mode for each Wiser Room.
The separate RoomStat driver exposes physical thermostat temperature, humidity, estimated battery percentage, and signal strength through the same parent hub.
The HotWater driver is implemented and exposes state, mode, next event, and fixed 30/60-minute boost buttons with cancel. The `wiser-schedule` and `wiser-room-schedule` dashboard widgets render hot-water and room heating schedules.

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

### RoomStat Driver — implemented

Implemented in `drivers/roomstat/` as a read-only sensor. Pairing lists physical RoomStats from paired hubs, including unassigned units. See [pairing.md](./pairing.md#roomstat-pairing) for mapping, limitations and outstanding hardware checks. Lock and identify controls remain future work.

### HotWater Driver

Implemented in `drivers/hotwater/`. See [hotwater.md](./hotwater.md) for capabilities, the boost buttons, and the schedule widget.

## Suggested Implementation Order

1. ✅ HotWater driver (small, single data source)
2. ✅ `wiser-schedule` widget for HotWater
3. ✅ Hot water boost buttons (30/60 minutes + cancel)
4. iTRV driver
5. ✅ RoomStat driver (temperature, humidity, battery and signal; live pairing checks outstanding)

## Technical Considerations

- Each child device should subscribe to domain and health updates through `WiserHubManager`, as the Room and Hot Water drivers do. Subscriptions may start before the parent Hub and survive its replacement.
- Child devices should not create their own polling loops; they receive domain updates from the hub.
- The `data.id` for each child device must be unique and stable (e.g., room ID, device ID, hot water ID).
- Register listeners in `onInit`, then use the manager's current hub and its cached domain or request a poll. If the hub is absent, reflect `not_ready` and wait for registration.
- Use the `onPoll` listener pattern from `RoomDevice` and `HubDevice` as a reference.
- Read the current client from `manager.get(hubId)` for writes. Stored child address/secret values are pairing snapshots and may be stale after discovery updates.
- Give new devices the same teardown and stale-domain guards so a delayed poll cannot mark a removed or replaced device available.

## Other Improvements

- **Repair flow — implemented**: update the hub secret or IP without deleting devices or Flows, after verifying the original ChipId. Legacy address-based devices need a previously learned ChipId. Live repair checks remain outstanding; see [pairing.md](./pairing.md).
- **Manual refresh capability**: a button or Flow action to force a poll now.
- **Insights**: expose signal strength, heating active hours, away mode toggles.
- **Flow cards**: room heating and Home/Away change triggers plus cancel actions are implemented. Hub heating-active and other actions remain planned.
- **Settings**: allow users to configure which rooms/devices are exposed.

## Hub Manager API

The `WiserHubManager` in `lib/wiser-hub-manager.ts` is the central point for accessing hub data from child devices.

```typescript
const manager = (this.homey.app as HubApp).hubManager;
const hub = manager.get(hubId);
const domain = hub?.getDomain() ?? null;
const health = hub?.getHealth();
```

Child devices store their parent Hub ID in `store.hubId` during pairing. Use `manager.subscribe(hubId, listenerId, onDomain)` and `manager.subscribeHealth(hubId, listenerId, onHealth)` for updates. Pair each with `unsubscribe` / `unsubscribeHealth` on teardown. The manager retains subscriptions until the parent registers and reattaches them on replacement.
