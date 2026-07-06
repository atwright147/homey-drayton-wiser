# Architecture

## Overview

The app is a Homey Pro (local-only) integration for the Drayton Wiser HeatHub. The HeatHub exposes a local REST API (`/data/v2/domain/`, etc.) that the app polls. The app creates a HeatHub device and then child devices for rooms, iTRVs, RoomStats, and hot water.

## Layers

```
Homey Driver/Device          lib/
────────────────────────────────────────────────────────
drivers/hub/driver.ts        lib/wiser-client.ts
  onPair                         fetch + auth + retry
drivers/hub/device.ts        lib/wiser-hub.ts
  registers WiserHub             poll loop + fan-out
  updates capabilities       lib/wiser-hub-manager.ts
drivers/room/driver.ts       lib/wiser-types.ts
  lists rooms from hubs      lib/wiser-utils.ts
drivers/room/device.ts       lib/wiser-errors.ts
  listens to hub poll
  updates room capabilities
```

## Key Components

### `WiserClient`

- Handles all HTTP/HTTPS traffic to the HeatHub.
- Uses `undici` for fetch.
- Adds the `SECRET` header.
- Defaults to HTTP with HTTPS fallback on connection errors.
- Default timeout: 10s, retries: 3.
- Uses a self-signed HTTPS agent (`rejectUnauthorized: false`).

### `WiserHub`

- Polls the hub at a configured interval.
- Maintains a map of listeners.
- Each listener receives the latest `WiserDomain`.
- Prevents concurrent polls and queues a pending poll.

### `WiserHubManager`

- Singleton created in `app.ts`.
- One `WiserHub` instance per paired hub.
- Devices register/unregister their listener with the manager.

### `HubDevice`

- Creates a `WiserClient` and `WiserHub` from store settings.
- Registers with the manager.
- Updates custom capabilities from the domain poll.
- Capability listener for `wiser_away_mode` writes back to the hub.

### `RoomDevice`

- Registers as a listener on the parent Hub's `WiserHub` via `WiserHubManager`.
- Falls back to creating its own `WiserClient`/`WiserHub` if the parent Hub is unavailable.
- Capabilities: `measure_temperature`, `target_temperature`, `measure_humidity`, `wiser_room_mode`.
- Humidity is read from the linked `RoomStat` (`RoomStatId` → `domain.RoomStat[].MeasuredHumidity`).
- Writing `target_temperature` sends a `RequestOverride` of type `Manual` with the new setpoint.
- Writing `wiser_room_mode` sends the mapped mode back to the hub.

## Capabilities

Custom capabilities defined in `.homeycompose/capabilities/`:

- `wiser_away_mode` — toggle
- `wiser_heating_active` — sensor
- `wiser_cloud_connected` — sensor
- `measure_signal` — sensor (percentage)
- `wiser_room_mode` — enum (auto / manual / off)

## Discovery

The `.homeycompose/discovery/wiser.json` strategy discovers mDNS-SD services named `http._tcp` matching `WiserHeat.*`. The driver links to it via `"discovery": "wiser"` in `driver.compose.json`.

## Pairing Design

### Hub Pairing

The Hub driver uses a custom pairing view (`drivers/hub/pair/start.html`):

1. Custom view loads and calls `discover` to get discovered hubs.
2. User selects a hub or enters an IP manually.
3. User enters the secret.
4. View emits `login` with `{ ip, secret }`.
5. Driver verifies the connection.
6. On success, view shows `list_devices`.
7. `list_devices` handler returns the verified hub.
8. `add_devices` adds the device.

### Room Pairing

The Room driver uses the default system templates (`list_devices` / `add_devices`):

1. `onPairListDevices` enumerates rooms from all paired Hub devices.
2. For each Hub, it fetches the cached domain via `WiserHubManager`.
3. Each room is returned as a candidate with a unique `data.id` and store values (`hubId`, `roomId`, `address`, `secret`, `useHttps`).
4. The user selects the rooms to add in the standard `add_devices` view.

## Important Decisions

- `module.exports = class` is used for `app.ts`, `driver.ts`, and `device.ts` because `export default` compiles to `exports.default` and Homey's direct `require()` class check fails.
- `homey` is not in `dependencies`; it is provided by the Homey runtime.
- Type definitions come from `@types/homey` (alias of `homey-apps-sdk-v3-types`).
- `pair/start.html` must be plain HTML with inline JavaScript. It does not include `/homey.js`; the `Homey` global is injected.
- The driver is `platforms: ["local"]` and `connectivity: ["lan"]`.
- The `login_credentials` system template was abandoned because `onPair` was never invoked in our test environment.
- `homey app run --remote` is required for reliable pairing tests; the default Docker mode does not route the pairing session correctly.
