# Brand: Liftside

## Name

Angle (fixes.md, option 1): a scanner for every bay that never asks for a
subscription and prints a report customers understand.

20 candidates: Baycheck, Liftside, Bayread, Codecard, Plugcheck, Readout, Counterside,
Shopglass, Bayline, Lamp, Clearbay, Wrenchnote, Tellcode, Codewise, Plainread,
Bayplug, Liftnote, Benchmark, Sidecar, Porta. Cut to 5: Liftside, Bayread, Codecard,
Plugcheck, Baycheck.

| name | US TM (USPTO, classes 9/42) | EU / CA / WIPO | domain | App/Play stores | handles | web search "name + scan tool / app" |
| --- | --- | --- | --- | --- | --- | --- |
| **Liftside** | to run | to run | to run | to run | to run | run 2026-11-25: no automotive app or scan tool found |
| Baycheck | — | — | — | — | — | run 2026-11-25: **taken** — "BayCheck AI", a repair-shop inspection app. Dropped. |
| Bayread | to run | to run | to run | to run | to run | to run |
| Codecard | to run | to run | to run | to run | to run | to run |
| Plugcheck | to run | to run | to run | to run | to run | to run |

These are screening checks, not legal clearance. Liftside is used inside the
shop only for now; if it is ever sold, a trademark lawyer should search it first.
Nothing in the name echoes the original (no "Maxi", no "Autel", no red).

## Palette

Brand teal `#0f6e66` on white (5.9:1), dark header `#12201e`. Red `#c22f2f`
means "fault" only, never brand. The original's red (`#e00010`, sampled from the
shop's report) is in `brand.json` so the sweep catches it. Contrast: 13 pairs,
0 AA failures.

## Logo brief

- Idea: the view from beside the lift — two posts, the arms, and a check mark: "checked on the lift".
- Mark: symbol + wordmark; symbol alone as the app icon.
- Must read at 16px (two posts + bar survive), and as a 1024px icon.
- Deliverables: SVG (`public/icon.svg`, a first draft), PNG 192/512, maskable 512, apple-touch 180 (rendered by `tools/make-icons.cjs`), social image 1200×630 (to make).
- Must not resemble the original: no red, no wordmark in caps, no swoosh.

## Voice: plain, calm, brief

- **Plain** — shop words, not jargon soup (not dumbed down: codes and readings stay exact).
- **Calm** — a check engine light is information, not an alarm (not soft: faults are named).
- **Brief** — one line where one line will do (not curt: say what to do next).

| do | don't |
| --- | --- |
| "3 trouble codes found" | "WARNING: SYSTEM FAULTS DETECTED" |
| "Turn the ignition on and try again." | "Error 0x23: protocol negotiation failure" |
| "Readiness monitors reset to 'not ready'." | "Monitors will be cleared." |
| "Not reported by this vehicle" | "N/A" |
| "Codes were cleared after this scan" | "Data invalidated" |

Most-seen strings (rewritten in this voice): Diagnose / "Scan a car and print the report";
"Connect adapter"; "Start scan"; "No trouble codes"; "Check engine light is ON";
"Clear trouble codes?"; "This turns off the check engine light…"; "The car did not answer.
Turn the ignition on and try again."; "No scans yet"; "Settings saved".
