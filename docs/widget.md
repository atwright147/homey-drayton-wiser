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
3. Fetches the cached domain from `WiserHubManager`.
4. Returns:
   - `state`: current heating state
   - `nextEvent`: next scheduled On/Off change
   - `schedule`: array of days with On/Off slots

### Important: Device ID vs Pairing Data

The value returned by `Homey.getDeviceIds()` is the Homey device ID (UUID), not the driver-defined `data.id` used during pairing (`hotwater-{hubId}-{hotWaterId}`). The API must match devices with `device.getId()`.

### Layout

The widget is fixed at 240px height. The schedule area is scrollable so all 7 days fit in the widget.

### Reloading

The widget reloads every 60 seconds and when the `settings` event fires.

## Widget Gotchas

- `Homey.api('GET', '/', { deviceId })` does not send the object as query parameters. Use a path parameter or encode the query string in the path.
- `Homey.getDeviceIds()` returns an array of selected Homey device IDs. For a singular widget, use `[0]`.
- `device.getData().id` is the pairing data, not the Homey device ID. Use `device.getId()` for widget lookups.
- Use `Homey.ready({ height: 240 })` to request the widget height. The actual rendered height may be fixed by the dashboard; design the UI to scroll or truncate gracefully.
- The widget HTML must not include `<script src="/homey.js">`. The `Homey` global is injected by the Homey runtime.
