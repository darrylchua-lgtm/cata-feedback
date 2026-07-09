# cata-feedback — merchant beta feedback portals

Per-merchant feedback sites at `cata-feedback.vercel.app/<slug>`. Merchants' beta
testers report bugs/suggestions via an embedded Tally form and track their status
on a branded page. **Every push to `main` deploys live via Vercel.**

## Architecture (v2 — one form, one sheet)

```
tester ─▶ portal site (/<slug>)                             Darryl / CATA team
              │  Tally iframe ?merchant=<slug>                      │
              ▼                                                     ▼
        ONE Tally form ──▶ ONE Google Sheet (private) ◀── triage: Status,
              hidden field   one row per submission,       CATA response,
              "merchant"     "merchant" column             ☑ Create Jira
                                   │            │
                    Apps Script doGet(JSON,     └─ Apps Script trigger ──▶ Jira
                    filtered by ?merchant)                    (TECHSUPP, key
                                   │                           written back)
              portal tracker tab ◀─┘
```

- One Tally form for all merchants. Each portal embeds it with
  `?merchant=<slug>`, which fills a hidden `merchant` field, so every sheet row
  is tagged with its merchant.
- One private Google Sheet. Sites don't read it directly — the bound Apps
  Script ([apps-script/Code.gs](apps-script/Code.gs)) serves per-merchant JSON
  and only the public columns, so merchants can't see each other's feedback and
  the sheet never needs to be shared publicly.
- New-submission alerts: the Tally form's Slack integration (connected
  2026-07-09) pings on every submission; tickets are raised manually from
  there. The Apps Script also contains an optional Jira sync (checkbox on a
  row → TECHSUPP ticket, key written back) — written and ready but NOT
  enabled: it needs a Jira API token + Script Properties (see Code.gs header).

## Day-to-day: add a merchant

```bash
python3 scaffold.py "Goldies" goldies --logo ~/Documents/cata/merchants/goldies/brand/logo.png
git add goldies && git commit -m "feat: add Goldies feedback portal" && git push   # push = live
```

Icon options: `--logo <file>` (copied into the folder), `--domain goldies.sg`
(favicon), or neither (initials; override with `--initials GD`, background with
`--icon-bg '#EAF2E3'`). That's the entire per-merchant setup — no new Tally
form, no new sheet.

Shared values changed (new form / new deployment URL)? Edit
[portal.config.json](portal.config.json), then `python3 scaffold.py --refresh`
to rewrite them into every v2 site.

## One-time setup (do once, in this order)

1. **Unified Tally form.** Duplicate one of the existing merchant forms
   (bc = `VL1x6g`). Keep the questions/labels exactly: *Your email*,
   *Description*, *Category*, *Merchant priority* — the sites map sheet columns
   by these names. Add a **Hidden fields block** (type `/` → "Hidden fields")
   with a field named `merchant`. It must be the dedicated Hidden fields block —
   a regular question with "hide" toggled does NOT capture URL parameters — and
   the name is case-sensitive (the portals send `?merchant=<slug>`). Remove any
   per-merchant redirect in "After submission" — the embed URL's `redirectTo`
   handles it. *(Done 2026-07-09: form `7R5rgA`.)*
2. **Sheet.** Connect the form's Google Sheets integration → new spreadsheet,
   tab named `Feedback` (or edit `SHEET_NAME` in Code.gs). Append columns:
   `Status`, `CATA response`, `Create JIRA` (Insert → Checkbox), `JIRA ticket ID`.
   Keep the sheet **private** — do not enable link sharing.
   *(Done 2026-07-09: sheet `1ceR55HKCWRozO5y3m5lr4c9-n25noL7K6kwoVhMByXQ`.)*
3. **Apps Script.** Extensions → Apps Script, paste
   [apps-script/Code.gs](apps-script/Code.gs). Deploy → New deployment → Web
   app, *Execute as: Me*, *Access: Anyone* → copy the `/exec` URL.
4. **Config.** Put the Tally form ID and the `/exec` URL into
   [portal.config.json](portal.config.json).
5. **Jira (optional but recommended).** In Apps Script: Script Properties
   `JIRA_SITE=catasg.atlassian.net`, `JIRA_EMAIL`, `JIRA_API_TOKEN`
   (id.atlassian.com → Security → API tokens). Run `installTrigger()` once and
   grant permissions. Defaults: project `TECHSUPP`, issue type `Task`.
6. Sanity-check: open `<exec-url>?merchant=test` (expect `{"rows":[]}`), then
   scaffold a test merchant, submit through its form, and confirm the row lands
   tagged and renders on the portal.

## Migrating the existing v1 sites (optional — decided against for now, 2026-07-09)

bc, pr and gyg stay on the old model (own form + own public-CSV sheet) and
keep working untouched; only new merchants use v2. If that ever changes:

| Site | Old Tally form | Old sheet ID |
| --- | --- | --- |
| bc (Box Coffee) | `VL1x6g` | `1o3QWFULbH7GhDR2szsswamWjOceDiJSEmEcWuQ0ea5s` |
| pr (Pizza Rimini) | `Np4pvl` | `1g7ga48PKP2hXZqbMMESCtQBT2MAnJ4n6CL-7BYLJT9g` |
| gyg | `XxBQ0j` | `1vkNq4b_tuqTnqWjkSYqll-f0LjoMB4RB1qGfEx3bmMk` |

Per site, after the one-time setup works: copy the old sheet's rows into the
unified sheet and fill the `merchant` column with the slug; re-scaffold with the
same slug (`python3 scaffold.py "Box Coffee" bc --logo bc/logo.png --force`);
commit + push; close the old Tally form and un-share the old sheet. The v1
sites keep working untouched until you do this — migrate one, verify, then do
the rest.

## Repo layout

| Path | What |
| --- | --- |
| `template/index.html` | v2 portal template. Placeholders `[MERCHANT NAME]`, `MERCHANT_SLUG`, `TALLY_FORM_ID`, `DATA_URL_HERE` are filled by scaffold.py — edit design here, never in merchant folders. |
| `scaffold.py` | Creates merchant folders from the template; `--refresh` re-applies shared config. |
| `portal.config.json` | The two shared values: unified Tally form ID + Apps Script web-app URL. |
| `apps-script/Code.gs` | Source of truth for the sheet-bound Apps Script (JSON API + Jira sync). Deployed manually — keep this copy in sync with the editor. |
| `<slug>/` | One deployed portal per merchant (bc, pr, gyg, …). |
