# Test plan

Automated: `npm test` (20 unit cases: decoders, ELM327 link, auto-scan on 3 simulated cars, database)
and `npm run e2e` (16 browser cases on the built app, each failing on any console error, with an
axe WCAG 2 A/AA scan on every screen). Selectors use roles and labels.

| ID | flow | case | how | result |
| --- | --- | --- | --- | --- |
| F01-H1 | connect & identify | demo car connects, VIN read automatically, year + make from VIN | e2e | pass |
| F01-E1 | | mistyped VIN (contains O) caught, Start disabled | e2e | pass |
| F01-E2 | | no adapter → sent to Connect; no Web Bluetooth explained | e2e | pass |
| F01-E3 | | clone adapter swallows first ATZ → retried | unit | pass |
| F01-N1 | | ignition off → "turn the ignition on" | unit | pass |
| F02-H1 | auto-scan → report | faults: stored/pending/permanent, freeze frame, EVAP not ready, report with DEMO marker, notes saved | e2e | pass |
| F02-H2 | | all-clear car, Clear disabled | e2e | pass |
| F02-H3 | | ISO 9141 car: multi-line VIN, legacy DTC frames | e2e + unit | pass |
| F02-E1 | | double tap Start scan → one scan | e2e | pass (was B2) |
| F02-E2 | | refresh mid-scan → reconnect resumes it | e2e | pass (was B1) |
| F02-E3 | | multi-ECU replies grouped per module; ISO-TP multi-frame; 29-bit headers | unit | pass |
| F03-H1 | clear codes | warning dialog, MIL off after, permanent code stays, monitors reset | e2e + unit | pass |
| F03-E1 | | Esc cancels, nothing cleared | e2e | pass |
| F04-H1 | live data | values stream, pause/resume, sensor toggle | e2e | pass |
| F06-H1 | history | search by plate, open report, vehicle history | e2e | pass (was B3) |
| F06-E1 | | second visit autofills customer | e2e | pass |
| S14-H1 | settings | saved, printed on report, backup export | e2e | pass (was B4) |
| D-1 | data | backup restore without duplicates, bad file rejected, forget customer | unit | pass |
| M-1 | phone width 390px | no sideways scroll on results and report | e2e | pass |
| O-1 | offline | app loads with network off after first visit | e2e | pass |

## Manual pass (needs the real shop setup — cannot be automated here)

- [ ] Real BLE adapter (e.g. Vgate iCar Pro BLE / OBDLink CX) pairs from Chrome on the Samsung tablet
- [ ] Scan 3 real cars: one CAN (2008+), one older (pre-2008), one with the check engine light on
- [ ] Codes match what the Autel MaxiSys shows for the engine module on the same car
- [ ] Clear codes on a car after a repair; re-scan shows light off
- [ ] Live data refresh rate acceptable (expect 3–10 values/second with a BLE adapter)
- [ ] Print the report from the tablet to the shop printer; save as PDF; share to a customer by text
- [ ] Install to home screen; open with Wi-Fi off
