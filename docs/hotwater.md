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
| `wiser_hotwater_boost_30` | button | Starts a 30-minute hot water override |
| `wiser_hotwater_boost_60` | button | Starts a 60-minute hot water override |
| `wiser_hotwater_boost_cancel` | button | Cancels the active hot water override and returns to the schedule |

## Device Class

`other` was chosen instead of `waterheater` so the custom `wiser_hotwater_mode` picker appears in the device details tab.

## Polling

`HotWaterDevice` registers a listener on the parent hub's `WiserHub` via `WiserHubManager`. The listener receives the merged domain on every poll and updates the three capabilities. If the parent Hub device is unavailable, the HotWater device falls back to creating its own `WiserClient`/`WiserHub`.

## Mode Writes

Writing `wiser_hotwater_mode` calls `WiserClient.setHotWaterMode(hotWaterId, mode)` and then triggers a poll so the capability values update immediately.

## Boost Controls

The button panel exposes three actions:

- `wiser_hotwater_boost_30` calls `WiserClient.setHotWaterOverride(hotWaterId, 30)` and then triggers a poll.
- `wiser_hotwater_boost_60` calls `WiserClient.setHotWaterOverride(hotWaterId, 60)` and then triggers a poll.
- `wiser_hotwater_boost_cancel` calls `WiserClient.cancelHotWaterOverride(hotWaterId)` and then triggers a poll.

These use the same client methods as the `boost_hot_water` Flow action.

The deprecated `wiser_hotwater_boost` and `wiser_hotwater_boost_duration` capability definitions remain in the manifest so existing devices can remove them cleanly during migration. They are not listed in the driver's `capabilities`, so they are not added to new devices.

## Schedule

The hot water's `ScheduleId` is used to look up its `WiserSchedule`. The next event is computed by `nextHotWaterEvent()` in `lib/wiser-utils.ts`, which first checks the schedule's `Next` field and then scans the weekly slots.

## Widget

The `wiser-schedule` dashboard widget renders the full weekly schedule for a selected hot water device. See `docs/widget.md` for details.
