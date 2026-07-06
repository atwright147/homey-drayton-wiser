# Test Fixtures

## domain.json

Captured from a real Drayton Wiser HeatHub `GET /data/v2/domain/` response (firmware 3.18.3).

PII / sensitive fields have been anonymised:

- `System.GeoPosition.Latitude` / `Longitude` → `0` / `0`
- `System.ChipId` → `0xAABBCCDD`
- `System.UnixTime` → `0`
- `System.LocalDateAndTime` → epoch placeholder
- `Zigbee.ZigbeeEUI` → `AABBCCDDEEFF0011`
- `Device[].SerialNumber` → `FEEDC0FFEE123456`

The Wiser hub secret is transmitted only as an HTTP header, so it never appears in this body.

## Refreshing the fixture

1. Open `test-hub.http` (gitignored) in an HTTP client.
2. Run the `### Domain - HTTP` (or HTTPS) request against your hub.
3. Replace the body in `domain.json` with the new response.
4. Re-anonymise the fields listed above.
