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

`HotWaterDevice` registers a listener on the parent hub's `WiserHub` via `WiserHubManager`. The listener receives the merged domain on every poll and updates `wiser_hotwater_state`, `wiser_hotwater_mode`, and `wiser_hotwater_next_event`. If the parent Hub device is unavailable, the HotWater device falls back to creating its own `WiserClient`/`WiserHub`.

## Mode Writes

Writing `wiser_hotwater_mode` calls `WiserClient.setHotWaterMode(hotWaterId, mode)` and then triggers a poll so the capability values update immediately.

## Boost Controls

The hot water device exposes three buttons in the Homey button panel:

| Button | Capability | Behaviour |
|--------|------------|-----------|
| Boost 30 min | `wiser_hotwater_boost_30` | `setHotWaterOverride(hotWaterId, 30)`, then poll |
| Boost 60 min | `wiser_hotwater_boost_60` | `setHotWaterOverride(hotWaterId, 60)`, then poll |
| Cancel Boost | `wiser_hotwater_boost_cancel` | `cancelHotWaterOverride(hotWaterId)`, then poll |

The durations are fixed so all three controls render together in the button panel. A picker or slider capability would be rendered in a separate panel on the device screen.

A boost sets a manual hot water override on the hub with `SetPoint` 1100 for the chosen number of minutes. It does not change `wiser_hotwater_mode`; the mode capability continues to report the schedule/manual state from the hub. Cancel clears the override and returns the cylinder to its schedule. Both actions use the same client methods as the `boost_hot_water` Flow action.

Button capabilities are action-only and do not hold state, so polling never overwrites them.

### Migration

Earlier development builds exposed `wiser_hotwater_boost` (single button) and `wiser_hotwater_boost_duration` (picker). `migrateCapabilities()` removes those from existing devices on `onInit` and adds the three fixed buttons.

Homey throws `Invalid Capability` (404) when removing a capability whose definition is no longer in the app manifest, and an uncaught error in `onInit` marks the device unavailable. For that reason both deprecated capability definitions remain in `.homeycompose/capabilities/`, and the removal is wrapped in `try/catch`. They are not listed in `driver.compose.json`, so new devices never receive them.

## Tests

`test/drivers/hotwater-device.test.ts` covers capability migration, the 30- and 60-minute boosts, cancel, removal failures, and hub-unavailable errors.

## Schedule

The hot water's `ScheduleId` is used to look up its `WiserSchedule`. The next event is computed by `nextHotWaterEvent()` in `lib/wiser-utils.ts`, which first checks the schedule's `Next` field and then scans the weekly slots.

## Widget

The `wiser-schedule` dashboard widget renders the full weekly schedule for a selected hot water device. See `docs/widget.md` for details.
