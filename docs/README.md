# Drayton Wiser Homey App — Documentation

This folder contains documentation for developers/agents working on the Homey Pro app for the Drayton Wiser UK HeatHub.

## Quick Links

- [Architecture](./architecture.md) — overall structure and design decisions
- [Pairing](./pairing.md) — how HeatHub pairing works, including mDNS discovery
- [Development](./development.md) — how to run, test, and debug the app, including Flow cards
- [Hot Water](./hotwater.md) — hot water capabilities, boost buttons, and schedule widget
- [Widget](./widget.md) — the `wiser-schedule` dashboard widget
- [Next Steps](./next-steps.md) — planned drivers and features
- [TODO](./todo.md) — missing features compared to the Home Assistant Wiser integration

## Project Context

- **Platform:** Homey Pro (local only)
- **Hub protocol:** LAN REST API on the Drayton Wiser HeatHub
- **Auth:** `SECRET` HTTP header
- **Transport:** HTTP with HTTPS fallback (self-signed certificate)
- **Test framework:** Vitest

## Current State

Three drivers are implemented:

- **HeatHub** — pairs via mDNS discovery or manual IP, authenticates with the hub secret, polls every 30 seconds, and exposes away mode, heating active, cloud connection, and signal strength.
- **Room** — temperature, target temperature, humidity from a linked RoomStat, and the room mode.
- **Hot Water** — state, mode, next scheduled event, and fixed 30/60-minute boost buttons with cancel.

The `wiser-schedule` dashboard widget renders the weekly hot water schedule.

Flow actions: **Boost heating** (`boost_room`) and **Boost hot water** (`boost_hot_water`).

iTRV and RoomStat drivers are planned.

## Important Notes

- Use `homey app run --remote` for pairing tests. The default Docker mode does not reliably route the pairing session.
- The custom pairing view does **not** load `/homey.js`. `Homey` is injected automatically.
- The `login_credentials` system template was abandoned because `onPair` was never invoked in our environment.
- Homey App Store submissions that require IP entry when discovery could be used will be rejected. mDNS discovery is mandatory.
- Capabilities added later are not present on already-paired devices. Drivers migrate them in `onInit`; see [development.md](./development.md#capability-migration).
