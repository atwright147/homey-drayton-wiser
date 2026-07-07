# Development

## Prerequisites

- Node.js 24+
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

# Validate the app
homey app validate

# Run on Homey Pro (recommended for pairing tests)
homey app run --remote

# Run in local Docker mode (not recommended for pairing)
homey app run

# Install as production app
homey app install
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

### Room

1. Pair the HeatHub first.
2. Add Device → Drayton Wiser → Wiser Room.
3. Select the rooms to add from the standard `list_devices` view.
4. If the room has a wall-mounted RoomStat, the device will also report humidity.

Note: Homey does not automatically add new capabilities to existing devices. If you add a capability to the Room driver after devices are paired, delete and re-pair the room device. Delete `.homeybuild` if the change is not reflected.

## Logs

When running `homey app run --remote`, logs stream to the terminal. Look for:

- `HubDriver onInit` — driver loaded
- `onPair session started` — pairing session began
- `discover handler called` — mDNS discovery requested
- `Login handler called` — user clicked Connect
- `Verify success` — connection verified
- `[onPoll]` — hub poll received (after adding device)

## Troubleshooting

| Symptom | Cause | Fix |
|--------|-------|-----|
| `Timeout after 10000ms` on `my.homey.app` | Browser blocked local network access | Allow the permission, or use the local URL |
| `Timeout after 10000ms` in Docker mode | Pairing session not routed to driver | Use `homey app run --remote` |
| `onPair` never logged | Stale build or wrong pairing approach | Delete `.homeybuild`, use custom view |
| `Could not load script: /js/homey.pair.js` | Custom view includes `/homey.js` | Remove the script tag |
| `verifyConnection` fails | Wrong secret or short timeout | Double-check secret; use default client timeouts |
| `Invalid Capability: ...` | Device was paired before the capability was added | Delete the device and re-pair; delete `.homeybuild` if needed |
| Old code still running | `.homeybuild` stale | Delete `.homeybuild` and re-run |
| Widget shows "Error loading schedule" | Widget API not receiving `deviceId` | Use a path parameter (`/:deviceId`) instead of query/body parameters |
| Widget shows "Device not found" | Looking up by pairing `data.id` instead of Homey ID | Use `device.getId()` in the widget API handler |
| Widget only shows 3 days | Fixed widget height clips content | Make the schedule area scrollable or reduce slot sizes |

## Testing Flow Cards

Flow cards are exercised in `test/drivers/flow-actions.test.ts`. The Homey SDK is mocked, so the tests verify that the driver registers the correct action card and calls the expected `WiserClient` method with the right arguments.

### Automated tests

```bash
npm test
```

This runs unit tests for `lib/` and the driver Flow-card registration.

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
