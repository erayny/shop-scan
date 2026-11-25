# Bugs

| ID | sev | title | status |
| --- | --- | --- | --- |
| B1 | S2 | Scan interrupted by refresh/disconnect is stuck "running", hidden from Reports, reconnect does not return to it | fixed |
| B2 | S3 | Double tap on Start scan creates two scans | fixed |
| B3 | S3 | Vehicle history screen has no link to it | fixed |
| B4 | S3 | Settings typed before they finish loading are wiped | fixed |

## B1 — interrupted scan stuck and hidden (S2)
Steps: connect demo car → Start scan → refresh the page while scanning → Reconnect.
Expected: after reconnecting, the scan carries on. Actual: Connect screen stayed put; the scan stayed `running` forever and never appeared in Reports.
Evidence: e2e F02-E2 (failing before fix). Fix: Reconnect link carries `next=/scan/:id/run`; Connect honours a path in `next`; Reports lists unfinished scans with "Not finished · resume".

## B2 — double scan (S3)
Steps: vehicle form → double tap Start scan. Expected: 1 scan. Actual: 2 scans saved.
Evidence: e2e F02-E1 ("expected 1 scan, found 2"). Fix: guard + loading state on the button.

## B3 — vehicle history unreachable (S3)
Steps: open any scan result. Expected: a way to see the car's earlier visits. Actual: route existed, nothing linked to it.
Evidence: e2e F06-H1. Fix: "Vehicle history (all visits)" link on results.

## B4 — settings lost (S3)
Steps: open Settings and type the shop name immediately. Expected: kept. Actual: the late-arriving stored settings overwrote it (only the field typed after load was saved).
Evidence: e2e S14-H1 screenshot showed the phone saved but not the shop name. Fix: form renders after settings load; updates are functional.

## To check (not reproduced)
- Very slow clone adapters (>5 s per reply) on real cars may need a longer timeout; the timeout is one constant in `Elm327`.
- Some cars answer mode 0A (permanent codes) with an error instead of NO DATA; the scan step is marked failed but the scan continues.
