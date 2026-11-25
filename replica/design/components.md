# Components

Icons: Lucide (ISC licence). Font: system UI stack with Inter if installed. No Autel
logo, icons or report wording. Tap targets ≥ 48px (gloved hands, tablet in a bay).

Button
  variants  primary, secondary, ghost, danger
  sizes     md 48px (default, tablet), sm 36px
  states    default, hover, active, focus-visible (2px ring accent, 2px offset), disabled, loading (spinner + label kept)
  tokens    primary bg accent/text on-accent; danger bg danger/text on-accent; secondary bg surface/border; radius md; font base/600
  a11y      real <button>; aria-busy when loading
  used on   all

Tile
  a big home button: icon 32px + label lg + one-line hint
  states    default, focus-visible, disabled (needs adapter)
  tokens    bg bg, border, radius lg, shadow card
  used on   S01

StatusPill
  variants  connected (success), connecting (warning, pulsing dot), disconnected (text-muted), error (danger)
  a11y      role=status, aria-live=polite; text always shown, not colour alone
  used on   header (all screens), S02

SystemRow
  system name · ECU id (muted, mono) · status icon + count
  variants  ok (check-circle, success, "0"), fault (wrench, danger, n), no_response (minus, muted, "—")
  used on   S05, S11

DtcRow
  code (mono, 600) · description · StatusBadge
  states    known code, unknown code ("Manufacturer-specific code — check service info")
  used on   S06, S11

StatusBadge
  confirmed (danger), pending (warning), permanent (danger, outlined), MIL on (danger, filled)
  used on   S06, S08

StepList
  rows with pending (circle), running (spinner), done (check, success), failed (x, danger) + detail text
  a11y      ordered list, aria-current on running step
  used on   S02, S04

ValueCard
  label · big value (xl, tabular-nums) · unit · sparkline (last 60 samples, accent stroke)
  states    live, stale (>3s, muted), unsupported (text "Not supported by this vehicle")
  used on   S09

Field (input)
  label above, 48px input, border-input, radius sm, hint/error text below
  states    default, focus (accent ring), error (danger border + message), disabled
  a11y      <label for>, aria-describedby for hint/error, aria-invalid
  used on   S03, S14

Dialog
  variants  confirm, danger-confirm (danger primary button, explains consequences)
  a11y      <dialog> with focus trap, Esc closes, focus returns to trigger
  used on   S10

Toast
  info, success, error; bottom centre; 4s; role=status
  used on   all

ReportSection
  heading with icon and count ("Systems checked (2)", "Trouble codes (3)"), red heading for faulted system groups
  print     no shadows, 0.5pt dividers, page-break-inside: avoid per row
  used on   S11
