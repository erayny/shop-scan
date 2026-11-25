# Deploy: Liftside → GitHub Pages

Date: 2026-11-25

## Preflight

| check | result |
| --- | --- |
| Unit tests (`npm test`) | 20 / 20 pass |
| Browser tests (`npm run e2e`, 16 cases, console errors + axe on every screen) | 16 / 16 pass |
| Production build (`npm run build`) | pass, ~110 kB gzipped JS |
| Parity (`parity.py`) | 88.6; must-haves 13 of 16 (3 partial: real-adapter test, code description coverage, system list limited to powertrain) |
| Rebrand sweep (`sweep.py --config replica/brand.json`) | clean |
| Store listing (`listing.py`) | n/a — not going to app stores |
| Dependencies (`npm audit --omit=dev`) | 0 vulnerabilities |
| Open S1 / S2 bugs | none (B1–B4 fixed) |
| Privacy | no server, no analytics, no cookies; data stays on the tablet; README says so. No policy page needed for in-house use. |
| Icons, title, manifest | Liftside icon set, 192/512/maskable PNG + SVG |

**Verdict:** by the pack's rule it is not "shippable" (3 must-haves partial).
It is published as an **in-house beta** because the blocking item — trying
it with a real adapter on the shop's Samsung tablet — can only happen once it
is on the tablet, and installing needs an HTTPS address. The user asked to
publish.

## Host

GitHub Pages from `.github/workflows/pages.yml`: every push to `main` runs the
unit tests, builds and publishes `dist/`. No env vars, no secrets, no
database, no domain needed. URL once live: `https://erayny.github.io/shop-scan/`
(or `/liftside/` if the repo is named that).

Steps:
1. Create an empty **public** repo on GitHub (Claude's GitHub app could not create it: 403).
2. Push `main` (Claude does this once the repo exists and the app has access).
3. Repo Settings → Pages → Source: **GitHub Actions** (one click; the API call is blocked from this session).
4. Watch the "Test and publish" action go green, then open the URL.

Custom domain later (optional): add a CNAME record `scan` → `erayny.github.io`
at your registrar and enter `scan.<yourdomain>` in Settings → Pages.

## First week, watch
- The Pages action stays green on every push.
- On the tablet: install, run the manual checklist in `test-plan.md`.
- Note any adapter that will not connect (name + model) and any car that will not answer.
