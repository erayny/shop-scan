# Recon map: Autel MaxiSys diagnostic scan (Android tablet)

Scope: generic OBD-II diagnosis — identify vehicle, auto-scan, read/clear trouble
codes, freeze frame, readiness monitors, live data, and the printable/emailable
customer scan report. The emissions/engine side every 1996+ US car exposes over
the public OBD-II standard (SAE J1979), through an off-the-shelf Bluetooth LE
ELM327-compatible adapter.
For: the shop that commissioned it — an in-house tool for the shop's techs and customers.
Date: 2026-11-25

## Sources

| # | source | URL / location | notes |
| --- | --- | --- | --- |
| 1 | Shop's own Autel report: 2022 Toyota Camry HV, 36 systems, 7 DTCs | `replica/screens/autel-report-2022-toyota.pdf` (2025-08-28) | best source: real output of the tool, every section of the report |
| 2 | Shop's own Autel report: 2009-era Mercedes S550 4MATIC, 53 systems, 69 DTCs | `replica/screens/autel-report-benz.pdf` (2025-08-18) | shows OEM code format (`1089 … (P0456)`) and status strings like `MIL ON&Stored&Current` |
| 3 | OBD-II PIDs reference (public) | https://en.wikipedia.org/wiki/OBD-II_PIDs | modes 01/02/03/04/07/09/0A, PID formulas |
| 4 | ELM327 command set (public datasheet) | https://www.elmelectronics.com/ | AT commands, protocol auto-detect, response format |
| 5 | Web Bluetooth spec (public) | https://webbluetoothcg.github.io/web-bluetooth/ | BLE GATT access from Chrome on Android |

Not used: Autel software, firmware, VCI protocols or vehicle databases. Nothing
decompiled, no Autel network traffic logged. The shop's reports contain a
customer's name and phone number; they stay in `replica/screens/` (git-ignored)
and never ship.

## Core loop

Plug in, auto-scan the car, and hand the customer a clean report of what is wrong.

## Screens

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Home | `/` | entry: Diagnose, Reports, Vehicles, Settings | tile buttons, adapter status pill | adapter connected, not connected |
| S02 | Connect adapter | `/connect`, from status pill or Diagnose | pick and connect BLE OBD adapter, init ELM327 | device chooser (browser), progress steps, log | idle, connecting, protocol search, connected, error (no adapter, ignition off, unsupported browser) |
| S03 | Vehicle & customer | `/scan/new` | VIN (auto from mode 09), year/make/model, odometer, plate, customer name/phone, RO number | form, VIN read button, autofill from history | empty, VIN auto-read, VIN unavailable (pre-2005), filled |
| S04 | Auto-scan progress | `/scan/:id/run` | runs each check in order | step list with spinners/checks, cancel | running, step failed, done |
| S05 | Scan results | `/scan/:id` | "System Scanned (n)" list with status/DTC count per system | system rows (green check / red wrench + count), summary chip | all clear, faults found |
| S06 | DTC list | `/scan/:id/dtcs` | DTCs grouped by system: code, description, status | grouped table, status badge | none, many, unknown code |
| S07 | Freeze frame | `/scan/:id/freeze` | snapshot of sensor values when the MIL set | key/value table | none stored, filled |
| S08 | Readiness monitors | `/scan/:id/readiness` | I/M monitors complete / incomplete / n/a, MIL state | monitor rows, overall pass verdict | ready, not ready, MIL on |
| S09 | Live data | `/live` | pick PIDs, stream values, mini graph | PID picker, value cards, sparkline, pause/record | not connected, streaming, paused, PID unsupported |
| S10 | Clear codes | modal from S05/S06 | confirm erase (turns MIL off, resets monitors) | danger confirm dialog | confirm, clearing, cleared, failed |
| S11 | Report | `/scan/:id/report` | printable report: shop header, report ID, vehicle, customer, device, systems, DTCs, tech notes, signature lines | report layout, print/PDF/share | preview, printing |
| S12 | Report history | `/reports` | past scans, search by VIN/plate/name | list, search | empty, filled |
| S13 | Vehicle history | `/vehicles/:vin` | all scans of one vehicle over time | timeline | one scan, many |
| S14 | Settings | `/settings` | shop name/tel/email/address, technician, units (km/mi), adapter | form | — |

## Flows

```
F01 Connect adapter and identify the vehicle
    S01 -> S02 -> S03
    happy path clicks: 4 (Diagnose, Connect, pick device, Read VIN)
    edge: no BLE adapter in range, ignition off (NO DATA / UNABLE TO CONNECT),
          browser without Web Bluetooth, adapter drops mid-session, VIN not supported

F02 Auto-scan and give the customer a report  (core loop)
    S03 -> S04 -> S05 -> S06 -> S11
    happy path clicks: 3 after F01 (Start scan, View report, Print/Share)
    edge: no codes (all clear), pending-only codes, permanent codes, unknown code,
          adapter disconnects mid-scan, multiple ECUs answer (engine + transmission)

F03 Clear codes after a repair and re-check
    S05 -> S10 -> S04 -> S05
    happy path clicks: 3
    edge: engine running (some ECUs refuse), codes return immediately (hard fault)

F04 Watch live data
    S01 -> S09
    happy path clicks: 2 + PID picks
    edge: PID unsupported by this car, slow adapter (low refresh rate), disconnect

F05 Pre-inspection readiness check
    S04 -> S08
    edge: monitors incomplete after a recent clear, MIL on

F06 Find a past report and re-share it
    S01 -> S12 -> S11
    happy path clicks: 3
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Button | primary, secondary, ghost, danger | default, focus, disabled, loading | all |
| Tile button | home tile | default, disabled | S01 |
| Status pill | connected, connecting, disconnected, error | — | header, S01, S02 |
| System row | ok (check + 0), fault (wrench + count), not supported | — | S05, S11 |
| DTC row | code, description, status badge | confirmed, pending, permanent, history | S06, S11 |
| Status badge | confirmed/stored, pending, permanent, MIL on | — | S06, S08 |
| Step list | pending, running, done, failed | — | S02, S04 |
| Value card | number + unit + sparkline | live, stale, unsupported | S09 |
| Text input / form field | text, number, tel | default, focus, error | S03, S14 |
| Dialog | confirm, danger confirm | — | S10 |
| Toast | info, success, error | — | all |
| Report section header | icon + title + count | — | S11 |

## Inferred data model

```
Shop        name, tel, email, address, technician_default, units (km|mi)
            evidence: report header "Shop / Tel / Email / Address / Technician"
            confidence: high
Customer    id, name, tel
            evidence: report "Customer Information Name / Tel"   confidence: high
Vehicle     vin (pk), year, make, model, engine, plate
            evidence: "2022/Toyota/Camry HV/A25A-FXS", VIN, License Plate   confidence: high
Scan        id, report_id ("SCAN" + yyyymmddhhmmss), vehicle_vin, customer_id,
            odometer, odometer_unit, technician, ro_number, adapter_name,
            protocol, started_at, mil_on, notes
            evidence: Report ID MAXIA20250828153751, Test Time, Odometer, RO number   confidence: high
SystemResult scan_id, system (Engine/Powertrain, Transmission, ...), ecu_address,
            status (ok|fault|no_response), dtc_count
            evidence: "System Scanned (36)" table   confidence: high (generic OBD only sees powertrain ECUs)
Dtc         scan_id, system, code (P0456), description, status
            (confirmed|pending|permanent), freeze_frame (json)
            evidence: DTC tables, statuses Confirmed / History / MIL ON&Stored&Current   confidence: high
Readiness   scan_id, monitor, supported, complete
            evidence: public J1979 mode 01 PID 01   confidence: high (not in Autel report — added)
```

Relationships: Customer 1-n Scan, Vehicle 1-n Scan, Scan 1-n SystemResult, Scan 1-n Dtc, Scan 1-n Readiness.

## Feature matrix

See `features.csv`. Must: 16, should: 9, could: 4, skip: 8.

## Out of scope (cannot or should not be cloned)

- **OEM full-system scan** (the 36/53 modules: airbag, ABS, smart key, ADAS,
  body). Needs per-manufacturer module addresses and code databases that Autel
  licenses or builds; a generic adapter cannot see them reliably.
- **OEM-specific code descriptions** (Mercedes `1089`, `742900` etc.) — Autel's database.
- **Special functions**: key programming, ECU coding, ADAS calibration, TPMS
  sensor programming, service resets. OEM-specific and safety-critical.
- **Autel's VCI hardware** — replaced by an off-the-shelf BLE OBD adapter.
- **Autel cloud, repair info, ALLDATA integration** — their network/partners.
- **Autel's logo, report branding and disclaimer wording** — the report is rebuilt with the shop's own branding and words.

## Size

Screens 14, flows 6, entities 7. Hard parts: (1) BLE + ELM327 talk across many
cheap clone adapters (timeouts, echo, protocol search, multi-ECU replies);
(2) decoding modes 01/02/03/07/09/0A correctly and building a code-description
table without anyone's proprietary database; (3) an offline, printable report
that looks professional on a tablet. Size: **M** (a few weeks to production
quality; a working first version is much faster).
