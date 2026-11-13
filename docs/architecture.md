# Architecture

## Overview

This Homey Pro app uses the Wiser HeatHub LAN REST API and mDNS discovery. The implemented devices are HeatHub, Room, RoomStat, and Hot Water. The iTRV driver is planned.

The paired HeatHub owns one `WiserClient` and one polling `WiserHub`. `app.ts` creates a single `WiserHubManager`; room, RoomStat and hot water devices subscribe to their parent hub through that manager. Child devices can start before the hub device, and their subscriptions attach when it registers. They do not start separate polling clients.

## Components

| Component | Responsibility |
|-----------|----------------|
| `lib/wiser-client.ts` | Authenticated HTTP requests, transport fallback, request deadlines, cancellation, and Wiser write methods |
| `lib/wiser-hub.ts` | Polling, current domain cache, health state, and domain fan-out |
| `lib/wiser-hub-manager.ts` | One hub per paired HeatHub ID, pending child subscriptions, replacement, and teardown |
| `drivers/hub/` | Pairing, discovery identity, hub settings, capabilities, and diagnostics |
| `drivers/room/` | Room pairing, temperature/humidity/mode, and setpoint writes |
| `drivers/roomstat/` | Physical RoomStat pairing, temperature/humidity/battery/signal, and availability |
| `lib/wiser-roomstat.ts` | SDK-free RoomStat/device/room mapping and validation |
| `drivers/hotwater/` | Hot water pairing, state/mode/next event, and boost controls |
| `widgets/wiser-schedule/` | Read-only hot water schedule dashboard widget |

### Client and request lifecycle

`WiserClient` sends the hub secret in the `SECRET` header. It starts on HTTP unless `useHttps` is enabled. A GET connection failure can cause an HTTPS fallback; a successful fallback becomes the client's preferred protocol. HTTPS uses an agent that accepts the hub's self-signed certificate.

Each request attempt has a 10-second default deadline covering the response body as well as the connection. GET requests make up to three attempts per protocol by default. Writes (PATCH) make one attempt and do not switch protocols: a timeout may occur after the hub has already applied a write. Replaying it could duplicate an action. Authentication failures and non-retryable REST errors do not retry. A client switch or hub shutdown aborts pending requests and disposes the old client's HTTPS agent.

Pairing creates temporary clients for verification and device listing, then disposes them. Hot water pairing may make a temporary direct poll if the managed hub has no domain; that client is also disposed.

### Hub ownership and subscriptions

The manager exposes `register`, `unregister`, `get`, `subscribe`, `unsubscribe`, `subscribeHealth`, and `unsubscribeHealth`. Child subscriptions are retained even when the hub is not registered, then attached to a newly registered or replacement hub. Replacing a hub disposes the old one. An unregister call with an expected hub does not remove a newer replacement.

`WiserHub` prevents concurrent polls, queues a pending poll, and gives each domain listener the latest successful domain. A new listener receives the cached domain when one exists. A client change clears that cache, cancels old requests, and starts a poll with the new client while preserving subscriptions. Stale responses from a previous client or hub generation are discarded.

Health starts as `not_ready`. Failure before the first successful poll marks the hub unavailable immediately. After success, authentication failure is immediate; connection failure marks it unavailable after three consecutive failures or when the last success is at least two poll intervals old. Unavailable health clears the cached domain. A successful poll restores availability. Hub, room, RoomStat, and hot water devices reflect the parent health, while the widget withholds stale schedule data. Listeners are removed on device teardown.

### Device settings and writes

The Hub device initializes its capabilities and diagnostic settings from polls. Its Home/Away picker and legacy Away capability send a system `RequestOverride` and poll afterward; `OverrideType` supplies the displayed state, with `AwayMode` as a fallback. An omitted override on a valid System payload means Home. The read-only Away target temperature comes from `AwayModeSetPointLimit`. Comfort and eco capability listeners and settings also write through the active client and poll afterward. Changing `useHttps` replaces the client, while changing `pollInterval` resets the timer without creating another hub. Room and hot water mode settings use the same write and poll pattern as their capabilities. Room setpoint writes use a manual `RequestOverride`.

Child writes fetch the current client through `manager.get(hubId)` at action time. They do not use the address and secret snapshots saved in their pairing store, so a verified hub address change also reaches existing children.

## Pairing and discovery

The `.homeycompose/discovery/wiser.json` mDNS-SD strategy finds `http._tcp` services whose names match `WiserHeat.*`. The Hub driver links to it with `"discovery": "wiser"`.

The custom Hub pairing view sends `{ ip, secret, discoveryId }` when a discovered service is selected. The driver checks that the selected service still has that address, verifies the Wiser domain, and rechecks the address and `System.ChipId` before listing the device. `data.id` is the hub ChipId when present; `store.discoveryId` records the selected mDNS result ID. Manual IP entry remains available and does not set a discovery ID during pairing.

After pairing, the Hub device watches discovery results and address changes. It verifies `BrandName` and `ChipId` at the candidate address before updating `store.address` and switching the shared hub client. Existing ChipId-based devices without `store.discoveryId` can acquire one after a verified discovery match. Address-based legacy IDs cannot be matched this way and keep their stored address. A manually paired device with a ChipId may also acquire a discovery ID when its hub is later found; manual entry does not lock its address.

Room and hot water pairing enumerate items from paired hubs. They use the managed cached domain, with an on-demand poll when needed. Hot water pairing can make a temporary direct poll if the managed hub has no domain. Pairing stores `hubId` and the Wiser room or hot water ID; these link the child to its parent at runtime.

### Physical RoomStats

The RoomStat driver is a read-only sensor, separate from the room thermostat control. `lib/wiser-roomstat.ts` joins `Device` entries whose `ProductType` is `RoomStat` with `RoomStat` measurements on their shared `id`. `Room.RoomStatId` supplies the optional room name; neither naming nor room reassignment changes the paired ID. Pairing stores only `hubId` and `roomStatId`, with a hub-scoped `roomstat-{hubId}-{roomStatId}` data ID, and uses the managed cache or an on-demand shared poll. A failed hub does not prevent listing devices from other hubs.

Temperature uses the RoomStat's own measured value in tenths of a degree, not the room's calculated temperature. Humidity is already a percentage. Battery percentage uses the existing RoomStat voltage estimate (2.7 V full, 1.7 V empty), falling back to recognized coarse battery levels; it is an estimate, not a measured state of charge. Signal prefers valid negative `ReceptionOfDevice.Rssi`, then `ReceptionOfController.Rssi`, then the displayed-strength mapping. Explicit Offline or NoSignal reports force signal to zero.

Missing or invalid readings become null. A missing physical device or measurement record marks the Homey device unavailable; an explicit Offline status also marks it unavailable and clears temperature/humidity. Returning records restore availability. The device subscribes to parent domain and health updates, tolerates startup before the parent and hub/client replacement, checks for stale domains between updates, and removes both subscriptions on teardown. It creates no private client or polling timer. Existing Room devices and their controls are unchanged.

## Capabilities and schedules

Custom capabilities live in `.homeycompose/capabilities/`. The Hub exposes a Home/Away picker, read-only Away target temperature, comfort, eco, heating-active, cloud-connected, and signal values. Its former Away boolean remains hidden for existing Flows, while existing paired hubs gain the new capabilities on startup. Room exposes current and target temperature, linked RoomStat humidity when present, and room mode. Hot Water exposes heating state, mode, next event, and fixed 30/60-minute boost and cancel buttons. The Hot Water device migrates deprecated boost capabilities on startup.

`WiserHub` fetches schedules alongside each domain and merges nonempty results into the domain. `nextHotWaterEvent()` uses the hub's `Schedule.Next` when available, then scans weekly slots. Relative day labels and the slot comparison use the Homey timezone, including local midnight and daylight saving changes. The device gets the current timezone for each scheduled poll. If the timezone cannot be read, it displays `Timezone unavailable`; if no schedule exists, it displays `No schedule`.

The `wiser-schedule` widget reads the parent hub cache through a `/:deviceId` API route. It looks up the selected device by Homey's `device.getId()`, checks hub health before returning data, and uses the Homey timezone for the next event. See [widget.md](./widget.md).

## Homey runtime decisions

- Homey-loaded `app.ts`, `driver.ts`, and `device.ts` export their class with `module.exports`; `export default` does not satisfy the runtime's direct `require()` check.
- `homey` is supplied by the Homey runtime; `@types/homey` supplies TypeScript definitions.
- The custom pairing view does not load `/homey.js`; Homey injects the global.
- Pairing tests use `homey app run --remote` because the default Docker mode does not reliably route the pairing session.
