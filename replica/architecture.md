# Architecture: Shop Scan (generic OBD-II scan tool)

Reads `recon.md` and `features.csv`. Single shop, single tablet, works in a bay
with no Wi-Fi. No accounts, no payments, no server.

## Stack

| layer | choice | why |
| --- | --- | --- |
| app | Vite + React 18 + TypeScript, installable PWA | runs in Chrome on the shop's Android tablet, installs to the home screen, no app store, no Mac or Android SDK needed |
| car link | Web Bluetooth (BLE GATT) to an ELM327-compatible BLE adapter | the only Bluetooth API a web app has; supported in Chrome on Android and desktop. Adapter must be **BLE** (e.g. Vgate iCar Pro BLE, OBDLink CX, Veepeak BLE+), not Classic-only |
| styling | plain CSS custom properties from `replica/design/tokens.css` | tokens without a build plugin; replica-brand only changes values |
| storage | IndexedDB via Dexie | offline, survives restarts, enough for years of scans |
| report | HTML print stylesheet → browser "Save as PDF" / Android share | offline, no PDF library, prints on any printer |
| tests | Vitest (decoders, ELM parser, scan engine on a simulated car) + Playwright (flows, against the simulator) | the car is the hard thing to test; a simulator makes every flow testable |
| later: native wrapper | Capacitor + a Classic-Bluetooth plugin | only if the shop wants cheap Classic-only adapters or a Play Store build |
| hosting | any static host (GitHub Pages / Netlify / Cloudflare Pages) over HTTPS | Web Bluetooth requires HTTPS; nothing server-side |

## Modules

```
src/obd/transport.ts   Transport interface: write(line) / onData; BleTransport, SimTransport
src/obd/elm327.ts      command queue, waits for '>' prompt, timeouts, strips echo/headers, init sequence
src/obd/decode.ts      pure decoders: DTC bytes -> P0456, PID formulas, VIN, readiness bits
src/obd/dtc-db.ts      own plain-English descriptions for common generic codes + code-family fallback
src/obd/scan.ts        auto-scan engine: VIN, MIL/readiness, 03, 07, 0A, freeze frame, per-ECU grouping
src/obd/sim.ts         simulated vehicles (from the shop's two real reports) for demo + tests
src/db.ts              Dexie schema
src/ui/*               screens S01–S14
```

## Schema (IndexedDB, Dexie)

Single owner (the device), so no user_id / access rules: whoever holds the
tablet is the shop. Same model as SQL in `schema.sql` for a later cloud sync.

```
settings   key                      singleton: shop name/tel/email/address, technician, units
customers  ++id, name, tel
vehicles   vin, plate, make, year    model, engine
scans      ++id, reportId, vin, customerId, startedAt
           odometer, odometerUnit, technician, roNumber, adapterName, protocol,
           milOn, notes, systems[], dtcs[], readiness[], freezeFrame{}, status
```

Systems/DTCs/readiness are embedded in the scan record: they are written once
and always read together (a report is a snapshot).

## "API" (adapter commands, by flow)

| command | what | flow |
| --- | --- | --- |
| ATZ, ATE0, ATL0, ATS0, ATH1, ATSP0 | reset, echo off, headers on, auto protocol | F01 |
| 0100 | protocol search + which ECUs answer + supported PIDs | F01 |
| ATDPN | protocol in use | F01 |
| 0902 | VIN (multi-frame) | F01 |
| 0101 | MIL, DTC count, readiness monitors | F02, F05 |
| 03 / 07 / 0A | stored / pending / permanent DTCs per ECU | F02 |
| 0202 + 02xx | freeze frame DTC and values | F02 |
| 04 | clear DTCs | F03 |
| 01xx | live PIDs (RPM 0C, speed 0D, coolant 05, load 04, STFT/LTFT 06–09, MAF 10, throttle 11, timing 0E, IAT 0F, battery via ATRV) | F04 |

## Parts that bite

- **Clone adapters**: lie about versions, drop the first command, answer slowly — generous timeouts, retry once, `SEARCHING...`/`BUS INIT` tolerated.
- **Multiple ECUs answer** one request (engine 7E8 + transmission 7E9): headers on, group by ECU = the "System Scanned" rows.
- **CAN vs legacy protocols**: CAN replies carry a DTC count byte in 03/07/0A; K-line/J1850 don't. Decoder handles both.
- **Multi-frame ISO-TP** (VIN): `0:`/`1:` line prefixes and first-frame lengths.
- **Clearing codes** resets readiness monitors — the dialog says so (an inspection-fail trap).
- **BLE notify fragmentation**: responses arrive in 20-byte chunks; buffer until `>`.
- **Offline**: service worker caches the app; IndexedDB holds data. Export/backup of data to a JSON file so a broken tablet does not lose history.
- **Privacy**: customer names/phones live only on the tablet; a delete-customer action removes them.

## Build order

1. **Vertical slice**: simulator → ELM327 → decode → auto-scan → results → report (S02–S06, S11). Proves the stack without a car.
2. **Must-haves**: BLE transport, VIN, customer form, clear codes, history (S01, S03, S10, S12).
3. **Should-haves**: freeze frame, readiness, live data + graph, settings, vehicle history, share (S07–S09, S13, S14).
4. **Could-haves**: install/offline, record session.
5. **Fixes** from replica-entrepreneur.
