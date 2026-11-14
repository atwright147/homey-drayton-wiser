# Widgets

## `wiser-schedule`

Dashboard widget that displays the current hot water state, the next scheduled event, and the full weekly schedule for a selected hot water device.

### Files

- Manifest: `widgets/wiser-schedule/widget.compose.json`
- API: `widgets/wiser-schedule/api.js`
- UI: `widgets/wiser-schedule/public/index.html`
- Icons: `widgets/wiser-schedule/public/clock.svg`, `widgets/wiser-schedule/public/flame.svg`

### Device Selection

The widget uses the `devices` block in the widget manifest:

```json
"devices": {
  "type": "app",
  "singular": true,
  "filter": {
    "capabilities": "wiser_hotwater_state"
  }
}
```

The user selects a device when adding the widget. The selected Homey device ID is available in the widget HTML via `Homey.getDeviceIds()[0]`.

### API

The widget API endpoint is defined as a path parameter:

```json
"api": {
  "getSchedule": {
    "method": "GET",
    "path": "/:deviceId"
  }
}
```

The widget calls `Homey.api('GET', '/' + deviceId)` and the API handler receives the ID in `params.deviceId`.

### Server-Side Data

The API handler:

1. Finds the `hotwater` device by its Homey ID (`device.getId()`).
2. Reads `store.hubId` and `store.hotWaterId`.
3. Gets the parent hub from `WiserHubManager` and checks its health before using the cached domain. When the hub is missing, unhealthy, or has no domain, it returns `{ available: false, state: null, nextEvent: null, schedule: null }`.
4. Otherwise returns:
   - `available: true`
   - `state`: current heating state
   - `nextEvent`: next scheduled On/Off change in the Homey timezone, or `Timezone unavailable` if the clock lookup fails
   - `schedule`: an array of days with On/Off slots, or null when there is no matching schedule

The handler uses the shared `formatNextHotWaterEvent()` and `formatScheduleTime()` helpers in `lib/wiser-utils.ts`. It does not start a network request. Weekly slot times are displayed as supplied by the hub; the timezone is used for the relative next-event label and fallback search.

### Important: Device ID vs Pairing Data

The value returned by `Homey.getDeviceIds()` is the Homey device ID (UUID), not the driver-defined `data.id` used during pairing (`hotwater-{hubId}-{hotWaterId}`). The API must match devices with `device.getId()`.

### Layout

The widget requests a 240px height with `Homey.ready({ height: 240 })`. The schedule area scrolls when its content exceeds the available height. When the parent hub is unavailable, the UI shows `Unavailable` and clears the state and schedule from the previous successful load. If the timezone lookup fails while a schedule exists, weekly slots remain visible and the next-event field says `Timezone unavailable`.

### Reloading

The widget reloads every 60 seconds and when the `settings` event fires.

## Widget Gotchas

- `Homey.api('GET', '/', { deviceId })` does not send the object as query parameters. Use a path parameter or encode the query string in the path.
- `Homey.getDeviceIds()` returns an array of selected Homey device IDs. For a singular widget, use `[0]`.
- `device.getData().id` is the pairing data, not the Homey device ID. Use `device.getId()` for widget lookups.
- Use `Homey.ready({ height: 240 })` to request the widget height. The actual rendered height may be fixed by the dashboard; design the UI to scroll or truncate gracefully.
- The widget HTML must not include `<script src="/homey.js">`. The `Homey` global is injected by the Homey runtime.

## `wiser-room-schedule`

Read-only dashboard widget for a selected Wiser Room. It displays the room's scheduled target temperature, the next scheduled setpoint change, and the weekly heating schedule. It uses `widgets/wiser-room-schedule/widget.compose.json`, `api.js` and `public/index.html`; its device selector filters for `wiser_room_mode`.

The API matches `Homey.getDeviceIds()[0]` against the Room device's Homey ID, reads `store.hubId` and `store.roomId`, and uses only the shared hub cache. An unavailable hub or missing room returns no stale schedule or target. The room's `ScheduleId` selects its schedule. The live hub omits `Type` on heating schedules, so a missing type is accepted while an explicit non-heating type is rejected. `lib/wiser-room-schedule.ts` accepts v2 parallel `Time` (HHMM) and `DegreesC` arrays, and legacy `SetPoints` with HHMM `Time` values. Temperature values are tenths of a degree; `-200` means Off. Invalid slots are skipped and the remaining changes are ordered by time.

The next change is found by scanning the weekly schedule in Homey's timezone, including day and week rollover. A timezone error leaves the weekly slots visible and labels the next change `Timezone unavailable`. The widget refreshes every 60 seconds and on settings changes. It requests 240px height and scrolls the schedule area. It never writes to the hub. Live widget selection, layout and time values still need checking on Homey.
