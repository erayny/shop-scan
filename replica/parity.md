# Parity report

Date: 2026-11-25 · compared against the shop's own MaxiSys Ultra reports (2 PDFs).

| | score |
| --- | --- |
| **Overall** (parity.py, features + layout) | **75.1** |
| Features (weighted must 3 / should 2 / could 1) | **88.6** — 13 of 16 must-haves done, 3 partial |
| Layout, S11 report page 1 vs Autel report page 1 | 20.9 (different) |

## Why the layout number is low, and why that is fine

Both reports have the same order: shop header with report ID and test time →
"<vehicle> … Report" title → vehicle / customer details in two columns →
systems table (name, status icon, code count) → codes grouped by system →
technician notes → customer/technician/date signature lines. The edge-map diff
scores 20.9 because the Autel page is a dense 36-row module table and ours has
2 rows (a generic adapter only sees the powertrain modules), followed by a
summary banner and the readiness table Autel's report does not print. That is
a difference in data, not in structure, and the look is meant to differ (own
branding, no Autel trade dress).

## Missing, in build order

1. [must, partial] **Bluetooth on the real tablet with a real adapter** — written and simulated, not yet run on the Samsung. Blocks "shippable".
2. [must, partial] **Code descriptions** — ~200 common generic codes in our own words; the rest get a family explanation ("Generic powertrain code: ignition system or misfire…").
3. [must, partial] **Systems list** — 2–3 powertrain modules vs 36–53 on the MaxiSys. Ceiling of generic OBD-II; a per-make UDS module list could add some (could-have below).
4. [should, partial] **One-tap PDF share/email** — today: print → save as PDF, or share a text summary.
5. [could] Record/export a live data session; [could] UDS code read on common body/ABS modules per make.

## Behaviour differences

| flow | Autel MaxiSys | Shop Scan | keep / fix |
| --- | --- | --- | --- |
| F02 core loop | scan → report | Diagnose → (Connect → pick adapter, first time) → Start scan → Customer report → Print: 3 taps once connected | keep |
| VIN | auto VIN | auto VIN + year/make from VIN + autofill model, plate, customer from last visit | keep (better) |
| Report summary | systems table + DTCs | plain-English banner ("3 trouble codes found, check engine light ON, battery 12.4 V") + readiness | keep (better for customers) |
| Clear codes | clears | warns that readiness resets and permanent codes stay, then re-scans automatically | keep (better) |
| Interrupted scan | — | resumes after reconnect, listed as "Not finished" | keep |
| Coverage | 36–53 OEM modules, special functions | engine/emissions only | known limit — keep the Autel for OEM work |
| Report delivery | PDF, email | print/PDF, share text | fix (item 4) |

## Verdict

**Not shippable yet** by the pack's rule: 3 must-haves are partial. Two are
the ceiling of generic OBD (system coverage) or a word list that only grows
(descriptions); the one that truly blocks is item 1, the first real-car test on
the tablet. No open S1 or S2 bugs.

## Top five to build next

1. Real-adapter test on the Samsung (needs the shop: adapter + car).
2. One-tap PDF: generate the PDF in the app and hand it to Android's share sheet (SMS, email, WhatsApp).
3. Extend code descriptions with the shop's most common codes (feed them from real scans).
4. Fixes from replica-entrepreneur (next step).
5. Live data record + CSV export for comebacks.
