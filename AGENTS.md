# Agent Guidance

This file contains project-specific guidance for coding agents (including OpenCode) working on the Drayton Wiser Homey Pro app.

## Project Goal

Build a Homey Pro app that integrates with the Drayton Wiser HeatHub local API and exposes rooms, iTRVs, RoomStats, and hot water.

## Platform

- Homey Pro / Self-Hosted only (`platforms: ["local"]`)
- Uses LAN REST API + mDNS discovery
- TypeScript with `homey` CLI

## Code Style

- TypeScript strict mode
- No comments in source code
- Use `module.exports = class` for Homey-loaded files: `app.ts`, `driver.ts`, `device.ts`
- SDK-free code lives in `lib/` and is unit-tested with Vitest
- Use `undici` for HTTP

## Commands

Run these from `/Users/andy/Developer/Homey/homey-drayton-wiser`:

```bash
npm test          # Vitest
npm run lint      # ESLint
npx tsc --noEmit  # Type check
homey app validate
homey app build
homey app run --remote   # REQUIRED for pairing tests
```

## Pairing and Testing

- **Always use `homey app run --remote` for pairing tests.** Docker mode does not route the pairing session.
- Delete `.homeybuild` if code changes are not reflected.
- Pairing uses a custom view in `drivers/hub/pair/start.html`. It must NOT include `<script src="/homey.js">`.
- The `login_credentials` system template is not used.
- Manual IP fallback is allowed, but mDNS discovery is mandatory for App Store publication.

## Files to Leave Alone

- `test-hub.http` — user's manual scratchpad (gitignored)
- `test/fixtures/domain.json` — sanitised real hub payload; update only when needed

## Architecture

- `lib/wiser-client.ts` — HTTP client
- `lib/wiser-hub.ts` — poll loop and fan-out
- `lib/wiser-hub-manager.ts` — singleton per app
- `drivers/hub/device.ts` — hub device, registers with manager
- `drivers/room/device.ts` — room device, listens to parent hub poll
- `drivers/room/driver.ts` — room discovery from paired hubs
- `lib/wiser-types.ts` — domain types
- `lib/wiser-utils.ts` — helpers
- `lib/wiser-errors.ts` — errors

## Drivers

- `drivers/hub/` — HeatHub (complete, app-store-ready)
- `drivers/room/` — Room thermostat (complete: temperature, setpoint, humidity from RoomStat, mode)
- Planned: iTRV, RoomStat, HotWater
- Drivers are SDK v3; follow the `drivers/hub/` pattern.

## Important Gotchas

- `export default` fails in Homey-loaded files because `require()` expects the class directly.
- The `Homey` global in pairing views is injected automatically.
- `this.homey` is the Homey SDK instance inside `Driver`, `Device`, and `App`.
- Discovery results are accessed via `this.getDiscoveryStrategy().getDiscoveryResults()`.
- Custom capabilities must be defined in `.homeycompose/capabilities/` and referenced by ID.

## Documentation

See `docs/` for detailed documentation:
- `docs/architecture.md`
- `docs/pairing.md`
- `docs/development.md`
- `docs/next-steps.md`

## Common Checklist Before Saying Done

- `npm run lint` passes
- `npm test` passes
- `homey app validate` passes at `publish` level
- `.homeybuild` is clean if pairing was tested
- No secrets in logs or committed files
