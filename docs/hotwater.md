# Hot Water

The `drivers/hotwater/` driver exposes a Wiser hot water cylinder as a Homey device.

## Data Source

- Domain: `WiserDomain.HotWater[]`
- Schedule: `WiserDomain.Schedule[]` (loaded via `WiserClient.getSchedules()` and merged into the domain by `WiserHub`)

## Pairing

1. `onPairListDevices` enumerates `HotWater` items from every paired HeatHub.
2. Each item is returned as a candidate with:
   - `name`: `Wiser Hot Water`
   - `data.id`: `hotwater-{hubId}-{hotWaterId}`
   - `store.hubId`: parent Hub `data.id`
   - `store.hotWaterId`: Wiser hot water `id`
   - `store.address`, `store.secret`, `store.useHttps`: for fallback polling
3. The user selects the device in the standard `list_devices` / `add_devices` flow.

## Capabilities

| Capability | Type | Meaning |
|------------|------|---------|
| `wiser_hotwater_state` | boolean | Currently heating (`WaterHeatingState` or `HotWaterRelayState` is `On`) |
| `wiser_hotwater_mode` | enum | `auto`, `on`, `off` (maps to Wiser `Auto`, `On`, `Off`) |
| `wiser_hotwater_next_event` | string | Next scheduled On/Off change, e.g. `Today 22:30 (Off)` |

## Device Class

`other` was chosen instead of `waterheater` so the custom `wiser_hotwater_mode` picker appears in the device details tab.

## Polling

`HotWaterDevice` registers a listener on the parent hub's `WiserHub` via `WiserHubManager`. The listener receives the merged domain on every poll and updates the three capabilities. If the parent Hub device is unavailable, the HotWater device falls back to creating its own `WiserClient`/`WiserHub`.

## Mode Writes

Writing `wiser_hotwater_mode` calls `WiserClient.setHotWaterMode(hotWaterId, mode)` and then triggers a poll so the capability values update immediately.

## Schedule

The hot water's `ScheduleId` is used to look up its `WiserSchedule`. The next event is computed by `nextHotWaterEvent()` in `lib/wiser-utils.ts`, which first checks the schedule's `Next` field and then scans the weekly slots.

## Widget

The `wiser-schedule` dashboard widget renders the full weekly schedule for a selected hot water device. See `docs/widget.md` for details.
