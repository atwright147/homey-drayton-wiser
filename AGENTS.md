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
- Export the class directly with `module.exports` in Homey-loaded files: `app.ts`, `driver.ts`, `device.ts`. Named classes followed by `module.exports = ClassName` are supported.
- SDK-free code lives in `lib/` and is unit-tested with Vitest
- Use `undici` for HTTP

## Commands

Run these from the repository root:

```bash
npm test          # Vitest
npm run lint      # ESLint
npx tsc --noEmit  # Type check
homey app validate --level publish
homey app build
homey app run --remote   # REQUIRED for pairing tests
```

Use the [Homey CLI skill](.agents/skills/homey-cli/SKILL.md) for installation, target selection, remote testing, and post-install verification.

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
- `drivers/hotwater/device.ts` — hot water device, listens to parent hub poll
- `drivers/hotwater/driver.ts` — hot water discovery from paired hubs
- `widgets/wiser-schedule/` — dashboard widget for hot water schedule
- `lib/wiser-types.ts` — domain types
- `lib/wiser-utils.ts` — helpers
- `lib/wiser-errors.ts` — errors

## Drivers

- `drivers/hub/` — HeatHub: pairing, discovery recovery, Home/Away picker, read-only Away target temperature, comfort/eco modes, and diagnostics
- `drivers/room/` — Room thermostat: temperature, setpoint, humidity from RoomStat, and mode
- `drivers/hotwater/` — Hot water: state, mode, next event, 30/60-minute boost buttons, and schedule widget
- Planned: iTRV, RoomStat
- Drivers use SDK v3. The HeatHub owns the shared client and polling loop. Child drivers, including iTRV and RoomStat, should follow the Room/Hot Water pattern: subscribe to domain and health updates through `WiserHubManager`, resolve the current parent hub for writes, and unsubscribe on teardown.

## Manifests and Capability Changes

- Edit `.homeycompose/` and driver/widget compose files as the source of truth. Regenerate the tracked `app.json` with Homey tooling.
- Add new capabilities to the driver manifest for new pairings and migrate existing paired devices in `onInit`; manifest edits alone do not upgrade those devices.
- Preserve capability IDs used by existing Flows where possible. Keep deprecated capability definitions while migration code needs them for removal, and keep best-effort cleanup failures from aborting initialization.

## Important Gotchas

- `export default` fails in Homey-loaded files because `require()` expects the class directly.
- The `Homey` global in pairing views is injected automatically.
- `this.homey` is the Homey SDK instance inside `Driver`, `Device`, and `App`.
- Discovery results are accessed via `this.getDiscoveryStrategy().getDiscoveryResults()`.
- Custom capabilities must be defined in `.homeycompose/capabilities/` and referenced by ID.

## Widget Gotchas

- Widget API paths should use path parameters (`/:deviceId`). `Homey.api('GET', '/', { deviceId })` does not send the object as query parameters.
- `Homey.getDeviceIds()` returns Homey device IDs (UUIDs). Match widgets to devices using `device.getId()`, not `device.getData().id`.
- The widget HTML must not include `<script src="/homey.js">`. The `Homey` global is injected by the runtime.
- Use `Homey.ready({ height: 240 })` to request a widget height; design the UI to scroll if content exceeds the fixed height.

## Documentation

See `docs/` for detailed documentation:
- `docs/architecture.md`
- `docs/pairing.md`
- `docs/development.md`
- `docs/hotwater.md`
- `docs/widget.md`
- `docs/next-steps.md`

## Verification

- For code or manifest changes and release preparation, run `npm run lint`, `npm test`, `npx tsc --noEmit`, and `homey app validate --level publish`. Run `homey app build` when packaging or runtime behavior changes.
- For documentation-only changes, check the diff, referenced paths, and accuracy against the current implementation; app tests and builds are unnecessary unless executable behavior also changes.
- For pairing tests, ensure `.homeybuild` reflects the current source. If stale, delete that ignored build directory and rebuild before retesting; it does not need to be empty afterward.
- Record checks performed, failures, and outstanding hardware checks. Publish validation and mocked tests do not establish live pairing, control behavior, or App Store readiness.
- Keep secrets out of logs and committed files.

## Project Agents

Project-scoped Codex agent definitions live in `.codex/agents/`. All roles follow this file; their definitions add focused responsibilities. Model and permission settings are inherited from the parent session.

| Agent | Scope |
|-------|-------|
| `wiser-core` | Wiser API, domain mapping, polling, caching, hub lifecycle, and library tests |
| `homey-devices` | Homey drivers, pairing/repair, capabilities and migrations, Flow cards, translations, and driver tests |
| `quality-release` | Independent review, regression coverage, validation, CI, and documentation accuracy |

When delegated work is requested, select only the roles relevant to the task. The primary agent coordinates changes across boundaries, assigns non-overlapping file ownership, integrates results, and runs the final checklist. Feature agents write their own tests; `quality-release` provides independent verification. Small changes can stay with the primary agent.

Example requests:

- "Have wiser-core investigate hub replacement and child reconnection, then have quality-release review the findings."
- "Use homey-devices to implement the iTRV driver, with wiser-core verifying API mappings and quality-release reviewing the result."
- "Have quality-release check this branch for regressions and publish-level validation failures."

The planned `schedule-ui` specialist is deferred until schedule editing becomes an active task. The primary agent handles widget work in the meantime.
