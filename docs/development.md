# Development

## Prerequisites

- Node.js 22+ (see `package.json`)
- `homey` CLI authenticated to the Homey Pro
- Homey Pro on the same local network as the development machine

## Common Commands

```bash
# Install dependencies
npm install

# Run tests
npm test

# Run linter
npm run lint

# Type check
npx tsc --noEmit

# Build the Homey app archive
homey app build

# Validate for publication
homey app validate --level publish

# Run on Homey Pro (recommended for pairing tests)
homey app run --remote

# Run in local Docker mode (not recommended for pairing)
homey app run

```

## Running the App

For pairing tests, always use:

```bash
homey app run --remote
```

This runs the app directly on the Homey Pro. The default Docker mode does not reliably route the pairing session.

## Stale Build

If changes are not reflected after editing, delete the build cache:

```bash
rm -rf .homeybuild
homey app run --remote
```

## Pairing Test

### HeatHub

1. Run `homey app run --remote`.
2. Open `https://my.homey.app` or the local URL `https://192-168-x-x.homey.homeylocal.com`.
3. Add Device → Drayton Wiser → Wiser HeatHub.
4. Allow local network access if prompted.
5. Select the discovered hub or enter the IP.
6. Enter the secret.
7. Click Connect.
8. Select the hub in the `list_devices` view and add it.

For discovery recovery, change the hub's IP, wait for an mDNS address change, and check that the paired Hub and its existing children resume without re-pairing. Also test manual IP entry: it has no discovery ID at pairing time, but a ChipId-based device can become discovery-linked later.

### Room

1. Pair the HeatHub first.
2. Add Device → Drayton Wiser → Wiser Room.
3. Select the rooms to add from the standard `list_devices` view.
4. If the room has a wall-mounted RoomStat, the device will also report humidity.

Note: Homey does not automatically add new capabilities to existing devices. The Hot Water driver migrates its boost capabilities in `onInit`; the Room driver does not have a capability migration, so a future Room capability addition needs a migration or re-pairing. Delete `.homeybuild` if a code change is not reflected.

## Capability Migration

Device capabilities are part of the pairing data, so capabilities added later are not present on already-paired devices. `HotWaterDevice.migrateCapabilities()` runs in `onInit` and:

1. Removes a legacy `onoff` capability and deprecated boost controls when present.
2. Adds missing current state, next-event, and fixed boost button capabilities.

Two Homey behaviours matter when doing this:

- `removeCapability(id)` throws `Invalid Capability: <id>` with `statusCode: 404` if `id` is not defined in the app manifest. Keep the deprecated capability definition in `.homeycompose/capabilities/` until all devices have migrated, even though it is not listed in `driver.compose.json`.
- An uncaught error in `onInit` marks the device unavailable. Deprecated boost removal is best-effort and logged on failure. Other migration errors still abort initialization and need investigation.

When adding a capability to a driver, add it to `driver.compose.json` for new pairings and to the driver's migration list for existing devices.

## Logs

When running `homey app run --remote`, logs stream to the terminal. Look for:

- `HubDriver onInit` — driver loaded
- `onPair session started` — pairing session began
- `discover handler called` — mDNS discovery requested
- `Login handler called` — user clicked Connect
- `Verify success` — connection verified
- `HotWater poll` — hot water domain update (after adding that device)

## Troubleshooting

| Symptom | Cause | Fix |
|--------|-------|-----|
| `Timeout after 10000ms` on `my.homey.app` | Browser blocked local network access | Allow the permission, or use the local URL |
| `Timeout after 10000ms` in Docker mode | Pairing session not routed to driver | Use `homey app run --remote` |
| `onPair` never logged | Stale build or wrong pairing approach | Delete `.homeybuild`, use custom view |
| `Could not load script: /js/homey.pair.js` | Custom view includes `/homey.js` | Remove the script tag |
| `verifyConnectionWithDomain` fails | Wrong address, secret, or hub unavailable | Check the address and secret; the default deadline is 10 seconds per attempt |
| Hub and children unavailable | First poll failed, authentication failed, or connection failed repeatedly | Check the parent Hub, secret, and network; a successful poll restores availability |
| Hub IP changed but old address remains | No verified matching discovery result, or an address-based legacy device ID | Check mDNS visibility and ChipId; an address-based legacy device needs re-pairing |
| `Invalid Capability: ...` | Device was paired before the capability was added, or a deprecated definition was removed from the manifest too early | Add migration logic; keep deprecated definitions in `.homeycompose/capabilities/`; delete and re-pair as a last resort |
| Device unavailable after adding a capability | `onInit` threw while adding/removing a capability | Check logs for the error; make cleanup non-fatal; see Capability Migration |
| Old code still running | `.homeybuild` stale | Delete `.homeybuild` and re-run |
| Widget shows "Error loading schedule" | Widget API not receiving `deviceId` | Use a path parameter (`/:deviceId`) instead of query/body parameters |
| Widget shows "Device not found" | Looking up by pairing `data.id` instead of Homey ID | Use `device.getId()` in the widget API handler |
| Widget shows unavailable | Parent hub has no healthy cached domain | Restore hub connection; the widget clears stale schedule data until a successful poll |
| Next event says `Timezone unavailable` | Homey clock timezone could not be read | Check Homey timezone service; weekly slots can still display in the widget |

## Testing Flow Cards

Flow cards are exercised in `test/drivers/flow-actions.test.ts`. The Homey SDK is mocked, so the tests verify that the driver registers the correct action card and calls the expected `WiserClient` method with the right arguments.

### Automated tests

```bash
npm test
```

This runs Vitest unit and mocked Homey driver/widget tests, including client timeouts, writes, lifecycle, health, pairing, and Flow-card registration. Passing these tests does not verify a live HeatHub or remote pairing.

### Manual Flow tests

1. Build and run remotely:
   ```bash
   rm -rf .homeybuild
   homey app build
   homey app run --remote
   ```
2. In the Homey web/mobile app, create a new Flow.
3. Add a trigger and then add the action cards under **Drayton Wiser**.
4. Save and run the Flow.

#### Boost heating

- Flow action: **Boost heating**
- Arguments: target temperature (5–30 °C), duration (minutes)
- Sends to the hub:
  ```json
  { "RequestOverride": { "Type": "Manual", "SetPoint": <target × 10>, "DurationMinutes": <duration> } }
  ```

#### Boost hot water

- Flow action: **Boost hot water**
- Arguments: duration (minutes)
- Device buttons: **Boost 30 min**, **Boost 60 min**, and **Cancel Boost**.
- Sends to the hub:
  ```json
  { "RequestOverride": { "Type": "Manual", "SetPoint": 1100, "DurationMinutes": <duration> } }
  ```

### Important notes

- Always use `homey app run --remote` for Flow-card tests. Docker mode does not always register the cards correctly.
- Delete `.homeybuild` if the running app does not reflect recent code changes.
- If an existing Flow was created before an action card argument changed, re-create the action step in the Flow so it uses the new argument schema.

## Code Style

- TypeScript with strict compiler settings.
- ESLint with `athom/homey-app` config.
- No comments in source code (per project convention).
- Use `module.exports = class` for Homey-loaded entry files (`app.ts`, `driver.ts`, `device.ts`).
- SDK-free code lives in `lib/` and is unit-tested with Vitest.
