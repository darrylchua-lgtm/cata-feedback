# cata-feedback

Merchant beta-feedback portals, deployed by Vercel on every push to `main` —
**pushing publishes live websites**. Never push without Darryl's say-so; never
commit anything private (this repo is fully public-facing). Architecture,
setup and migration steps: [README.md](README.md).

## Rules

- New merchant sites come from `python3 scaffold.py "<Name>" <slug> …` — don't
  hand-copy `template/`. Slugs are short lowercase (bc, pr, gyg).
- Design/behavior changes go into `template/index.html`, then re-scaffold
  merchant folders (`--force`) to pick them up. Don't hand-edit generated
  `<slug>/index.html`.
- Shared config (Tally form ID, data URL) lives only in `portal.config.json`;
  apply changes with `scaffold.py --refresh`.
- `apps-script/Code.gs` mirrors the script deployed in the Google Sheet — if
  you change one, update the other.
- bc/, pr/, gyg/ may still be v1 (per-merchant sheet + form baked in); check
  README's migration table before assuming v2 behavior.
- Darryl prefers plain-English explanations of git operations and simple linear
  workflows (no rebase, no force-push).
