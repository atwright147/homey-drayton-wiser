# Drayton Wiser Homey App — Documentation

This folder contains documentation for developers/agents working on the Homey Pro app for the Drayton Wiser UK HeatHub.

## Quick Links

- [Architecture](./architecture.md) — overall structure and design decisions
- [Pairing](./pairing.md) — how HeatHub pairing works, including mDNS discovery
- [Development](./development.md) — how to run, test, and debug the app
- [Next Steps](./next-steps.md) — planned drivers and features

## Project Context

- **Platform:** Homey Pro (local only)
- **Hub protocol:** LAN REST API on the Drayton Wiser HeatHub
- **Auth:** `SECRET` HTTP header
- **Transport:** HTTP with HTTPS fallback (self-signed certificate)
- **Test framework:** Vitest

## Current State

The HeatHub driver is complete and publishable as a standalone app. It can:

- Pair via mDNS discovery or manual IP
- Authenticate with the hub secret
- Poll the hub every 30 seconds
- Expose away mode, heating active, cloud connection, and signal strength

All other Wiser device types (rooms, iTRVs, RoomStats, hot water) are planned.

## Important Notes

- Use `homey app run --remote` for pairing tests. The default Docker mode does not reliably route the pairing session.
- The custom pairing view does **not** load `/homey.js`. `Homey` is injected automatically.
- The `login_credentials` system template was abandoned because `onPair` was never invoked in our environment.
- Homey App Store submissions that require IP entry when discovery could be used will be rejected. mDNS discovery is mandatory.
