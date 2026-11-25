# What users hate, what is missing, the angle

## Sample size: 0 verbatim reviews

Review pages could not be read from this session: Trustpilot, the App Store,
Rennlist, diag.net and iatn.net all failed to resolve, and Reddit, Hacker News
and Apple's feeds were refused by the network proxy. So `reviews.csv` has no rows
and `reviews.py` was not run. **No quotes below are reviews.** What follows are
leads from search-result titles and summaries (paraphrased by the search tool,
not copied), each with the link to check by hand. Every theme is **thin** until
those pages are read.

To finish this step properly: open the links below in a browser, copy 1–3 star
reviews into `replica/reviews.csv` (`source,url,date,rating,text`), then run
`python3 <replica-entrepreneur>/reviews.py replica/reviews.csv --themes replica/themes.json --out replica/feedback.md`.

## 1. What they hate (leads, unverified)

| # | problem | where it showed up | evidence strength |
| --- | --- | --- | --- |
| H1 | A paid tool loses features or updates when the yearly subscription lapses; renewals cost real money | Trustpilot listing for autel.com (search summary: TrustScore 2/5, 109 reviews on the Dutch listing; reviewers describe paying again after a reset and a ~£400 tool "unusable" without annual fees) — https://uk.trustpilot.com/review/autel.com · Rennlist thread titled "autel scam deceptive marketing no active subcription no coding no key features" — https://rennlist.com/forums/cayenne-9y0-2019/1301547-autel-scam-deceptive-marketing-no-active-subcription-no-coding-no-key-features.html · diag.net "Regarding Autel scan tools renewal" — https://diag.net/discussion/s4d1xrkwyzblsf5mwwg7fts8za · Autel's own page on what an active subscription means — https://autel.us/?p=22976 | thin (not read), but 3 independent sources point the same way |
| H2 | Consumer OBD apps push weekly/monthly subscriptions to see basic results | Search summary of App Store listings for Torque Pro (weekly/monthly/yearly premium), Car Scanner (subscription option) — https://apps.apple.com/app/id6504351894 , https://apps.apple.com/us/app/id6737484293 | thin |
| H3 | Apps that don't work with generic ELM327 Bluetooth adapters | Search summary of OBD Fusion reviews — https://apps.apple.com/app/id650684932 | thin, one source |
| H4 | Slow support / refunds for subscription apps | Search summary of FIXD listing — https://play.google.com/store/apps/details?id=com.fixdapp.two | thin, one source |

## 2. What is missing

Nothing from reviews (none read). From the shop's own Autel reports: the
report is a module table with codes and Autel's wording; it has no
plain-English summary for the customer, no readiness section, and is shared
as a PDF only.

## 3. What is unsolved (positioning)

- A **second scanner for every bay**: the shop owns one expensive tablet;
  quick code reads, re-checks after a repair and customer printouts tie it up.
- **Explaining the result to the customer** in plain words, with a record of
  every visit.

## Fix plan (evidence × cheapness)

| # | fix | size | skill | evidence | status |
| --- | --- | --- | --- | --- | --- |
| X1 | No subscription, no account, nothing expires: all code on the tablet, works offline | — | (architecture) | H1, H2 | done |
| X2 | Works with any BLE ELM327-compatible adapter; adapter list on the Connect screen | S | build | H3 | done (generic GATT probing); real-adapter test pending |
| X3 | Plain-English summary banner on screen and report | S | build | §2 | done |
| X4 | Text the customer a summary in one tap (SMS to the number on file) | S | build | §2, §3 | done in this step |
| X5 | Clear-codes warning about readiness + automatic re-check | S | build | §3 | done |
| X6 | Vehicle history across visits | S | build | §3 | done |
| X7 | One-tap PDF to Android share sheet | M | build | §2 | next |

New rows added to `features.csv` with `original = no`.

## The angle (three options)

1. **For independent shops** who already own a pro scan tablet but need a quick
   reader in every bay, **Shop Scan** turns a $30 adapter and the shop tablet into
   a scanner that never asks for a subscription and prints a report customers
   understand. Evidence: H1 + H2 (thin).
2. **For service writers** who have to explain a check engine light at the
   counter, **Shop Scan** gives a one-line verdict, the codes in plain words and a
   text to the customer. Evidence: §2, §3 (the shop's own reports).
3. **For shops tired of renewals**, a scan tool that is yours: no account, no
   expiry, no cloud. Evidence: H1 (thin).

**Recommended: 1.** It is honest about what the app is (a companion to the
Autel, not a replacement for OEM-level work) and it is what this shop needs.
Never use Autel's name in the app, listing or ads.
