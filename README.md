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

## On a Windows PC with a J2534 pass-thru (MaxiFlash and others)

**Liftside Bridge** lets Liftside use a J2534 pass-thru device through the
device's own J2534 driver, the standard way PC software talks to these devices.

1. Install your device's **J2534 driver** from its maker and plug the device into the PC by USB.
2. Download **liftside-bridge-32.exe** from the Connect screen of the web app
   (or `downloads/` on the site). Windows may warn that it is from an unknown
   publisher, because it is not code-signed: choose *More info → Run anyway*.
3. Run it. A small window says "Liftside Bridge is running" and Chrome/Edge opens
   `http://127.0.0.1:8534/`. Keep the window open while you scan.
4. Connect → **J2534 pass-thru on this PC** → pick the device → **Connect pass-thru**.

If the bridge says the driver is 64-bit, use **liftside-bridge-64.exe** instead.
Pass-thru covers **CAN cars** (most 2008 and newer); older K-line and J1850 cars
are not read through pass-thru yet. The bridge only sends standard OBD-II reads
and "clear codes": it cannot write to or reprogram modules. It only accepts
connections from the PC it runs on.

Data saved in the PC browser is separate from the tablet's. Move it with
Settings → Export backup / Restore backup.

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

./tools/build-bridge.sh                                  # Windows bridge .exe files (needs Go 1.24)
dist-bridge/liftside-bridge-linux -sim benz -no-browser &   # bridge with a simulated device
node tests/e2e/bridge.mjs                                # browser test through the bridge
```

Planning documents from the build are in `replica/`.
