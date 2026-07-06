# Pairing

## HeatHub Pairing Flow

The Hub driver uses a custom pairing view rather than the `login_credentials` system template.

### Why a Custom View?

The `login_credentials` system template is the documented way to collect username/password. In our environment, pairing with this template resulted in a `Timeout after 10000ms` error and the driver's `onPair` method was never called. Switching to a custom view as the first step resolved the issue.

### Current Flow

1. **Custom view loads** (`drivers/hub/pair/start.html`).
2. View calls `Homey.emit('discover')` to get mDNS results.
3. Dropdown shows discovered hubs with manual IP fallback.
4. User enters the secret.
5. View calls `Homey.emit('login', { ip, secret })`.
6. Driver verifies the connection via `WiserClient.verifyConnectionWithDomain()`.
7. On success, view calls `Homey.showView('list_devices')`.
8. `list_devices` handler returns the verified hub.
9. `add_devices` adds the device.

### Pairing Code Location

- Manifest: `drivers/hub/driver.compose.json`
- Driver logic: `drivers/hub/driver.ts`
- View: `drivers/hub/pair/start.html`
- Translations: `drivers/hub/locales/en.json`

### Pairing on `my.homey.app`

- The custom view works on both the local URL (`https://192-168-x-x.homey.homeylocal.com`) and `https://my.homey.app`.
- The browser may ask for "Look for and connect to any device on your local network". The user must **Allow** this.
- If the permission is denied, Homey falls back to the cloud relay, which may not route the pairing session for LAN-only devices.

### Development Mode

- Use `homey app run --remote` for pairing tests.
- The default `homey app run` (Docker mode) does not reliably route the pairing session to the driver.
- The Docker mode may also cause stale `.homeybuild` artifacts; delete `.homeybuild` if the code changes are not reflected.

### Known Issues

- `login_credentials` template: `onPair` not invoked. Use custom view instead.
- Custom view: including `<script src="/homey.js" data-origin="pair">` causes `Could not load script: /js/homey.pair.js`. Remove this tag; `Homey` is injected automatically.
- Short client timeouts during pairing caused `verifyConnection` to fail. The pairing client now uses default timeouts (10s, 3 retries).
- The `pair` folder must contain a `start.html` file matching the `id` in the manifest.

### App Store Requirement

Homey will reject App Store submissions where users must enter an IP address if discovery could be used instead. The mDNS discovery strategy is mandatory for publication.

## mDNS Discovery

- Strategy file: `.homeycompose/discovery/wiser.json`
- Discovers: `http._tcp` services with names matching `WiserHeat.*`
- Driver link: `"discovery": "wiser"` in `drivers/hub/driver.compose.json`
- Runtime API: `this.getDiscoveryStrategy().getDiscoveryResults()`
- Result fields used: `id`, `name`, `address`

## Device Store and Settings

### Hub

After pairing, the device stores:

- `store.address` — hub IP address
- `store.secret` — hub secret
- `settings.pollInterval` — seconds between polls
- `settings.useHttps` — whether to use HTTPS

The `data.id` is the hub's `System.ChipId` (fallback to address).

### Room

After pairing, the room device stores:

- `store.hubId` — parent Hub `data.id`
- `store.roomId` — Wiser Room `id`
- `store.address` — hub IP address (for fallback polling)
- `store.secret` — hub secret (for fallback polling)
- `store.useHttps` — whether to use HTTPS (for fallback polling)

The `data.id` is `room-{hubId}-{roomId}`.

### Hot Water

After pairing, the hot water device stores:

- `store.hubId` — parent Hub `data.id`
- `store.hotWaterId` — Wiser HotWater `id`
- `store.address` — hub IP address (for fallback polling)
- `store.secret` — hub secret (for fallback polling)
- `store.useHttps` — whether to use HTTPS (for fallback polling)

The `data.id` is `hotwater-{hubId}-{hotWaterId}`.
