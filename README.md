# Liftside

An OBD-II scan tool for the shop tablet. Plug a Bluetooth LE OBD adapter into the
car, scan, and hand the customer a report they understand. No account, no
subscription, works without Wi-Fi. Everything stays on the tablet.

**What it reads:** VIN, check engine light, stored / pending / permanent trouble
codes with plain-English meanings, freeze frame, emissions readiness monitors,
live sensor data with graphs, battery voltage. It can clear codes (with a warning
about readiness) and re-check.

**What it does not do:** manufacturer-level work — airbag, ABS, body modules,
key programming, coding, ADAS calibration, TPMS programming. Keep the shop's
pro scan tablet for those. Generic OBD-II only sees the engine and emissions side.

## Install on the shop tablet (Android)

1. Open the app's web address in **Chrome** on the tablet.
2. Tap **⋮ → Install app** (or "Add to Home screen"). Liftside appears on the home screen.
3. Open it once with Wi-Fi on; after that it works offline.
4. **Settings:** enter the shop name, phone, email, address and default technician. They print on every report.

## The adapter

Any **Bluetooth LE** ELM327-compatible OBD-II adapter, for example Vgate iCar Pro
BLE, OBDLink CX or Veepeak BLE+. Classic-Bluetooth-only adapters cannot be used
from a web app. No adapter yet? Use **Connect → demo car** to try every screen.

## Daily use

1. Adapter in the port under the dash, ignition on (engine can be off).
2. **Diagnose** → Connect → pick the adapter (first time only).
3. The VIN is read and the year, make and last visit's details fill in. Add odometer and customer.
4. **Start scan** → results → **Customer report** → Print / save PDF, Share, or Text customer.
5. After a repair: **Clear codes**, then the app checks again.

**Backups:** Settings → Export backup, now and then. Scans live only on the tablet.

## For developers

```bash
npm ci
npm test          # unit tests: decoders, adapter link, simulated cars, database
npm run build
npm run preview   # then, in another terminal:
npm run e2e       # browser tests against the built app (needs Playwright + Chromium)
```

Planning documents from the build are in `replica/`.
