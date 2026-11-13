# Pairing

## HeatHub pairing

The Hub driver uses `drivers/hub/pair/start.html` as its first pairing view. The `login_credentials` system template did not invoke `onPair` in the development environment, so this app uses a custom view. Homey injects the `Homey` global; the view must not load `/homey.js`.

1. The view requests mDNS results with `Homey.emit('discover')` and lists discovered hubs. The user can also enter an IP address manually.
2. The user enters the hub secret and clicks Connect. The view emits `login` with `{ ip, secret, discoveryId }`; `discoveryId` is null for manual entry.
3. For a selected service, the driver checks that its current discovered address still equals `ip`. It then fetches the domain with a temporary `WiserClient` and requires `BrandName === 'WiserHeat'`.
4. The `list_devices` handler fetches the domain again. It rejects a changed `ChipId`, a non-Wiser domain, or a selected service whose address moved. It returns the HeatHub candidate, and Homey adds the selected device.

The pairing clients are disposed after each request. A selected service that moves during pairing must be selected again. The custom view and handler live in `drivers/hub/pair/start.html` and `drivers/hub/driver.ts`; the strategy is `.homeycompose/discovery/wiser.json`.

### Discovery identity and address recovery

The mDNS-SD strategy searches `http._tcp` for service names matching `WiserHeat.*`. A discovered pairing stores the service's result ID in `store.discoveryId`, its current IP in `store.address`, and the secret in `store.secret`. `data.id` uses `System.ChipId` when available, falling back to the address. The `discoveryId` identifies the mDNS service; the ChipId identifies the physical hub.

On startup and on discovery address changes, the paired Hub device verifies a candidate address by fetching its Wiser domain and matching `BrandName` and `ChipId`. Only then does it persist the new address and replace the shared client's connection. Existing room and hot water subscriptions continue on that same hub. A paired ChipId device without a discovery ID can acquire one after a verified match, including a device originally entered by IP. A legacy device whose `data.id` is its address cannot establish a ChipId match, so it keeps the stored address.

Manual IP entry is a fallback when discovery does not find the hub. It leaves `store.discoveryId` unset at pairing time. A manually entered hub with a ChipId may still become discovery-linked later; manual IP is not a permanent opt-out from address updates. There is no repair flow yet to edit a stored address or secret directly.

### Store and settings

| Device | Pairing data and store | Settings |
|--------|------------------------|----------|
| HeatHub | `data.id`: ChipId or address; `store.address`, `store.secret`, optional `store.discoveryId` | `pollInterval` (seconds), `useHttps`, comfort/eco controls, and read-only diagnostics |
| Room | `data.id`: `room-{hubId}-{roomId}`; `store.hubId`, `store.roomId`, plus address/secret/HTTPS snapshots | `roomMode` |
| Hot Water | `data.id`: `hotwater-{hubId}-{hotWaterId}`; `store.hubId`, `store.hotWaterId`, plus address/secret/HTTPS snapshots | `hotWaterMode` |

The child store snapshots are pairing data. At runtime, child polling and writes use the parent `WiserHub` obtained through `WiserHubManager`; the children do not start fallback polling clients.

## Child pairing

Room and Hot Water use the standard `list_devices` / `add_devices` views. Each driver enumerates items from paired HeatHubs. Room pairing reads a cached domain or polls the managed hub. Hot Water pairing also has a temporary direct-poll fallback if the managed hub has no domain. An unavailable hub may therefore produce no candidates until it reconnects. The returned `hubId` links each child to its parent.

## Remote pairing tests

Use `homey app run --remote`; the default Docker mode does not reliably route the pairing session. Open `my.homey.app` or the Homey local URL, permit local-network access if prompted, then test both discovered selection and manual IP entry. Delete `.homeybuild` if a changed view or driver is not reflected. Automated tests use mocked Homey APIs and do not establish that a real hub pairs successfully.
