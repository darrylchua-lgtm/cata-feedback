#!/usr/bin/env python3
"""Scaffold a merchant feedback portal from template/, or refresh shared config in all portals.

New merchant (one command, then commit + push to go live):
    python3 scaffold.py "Goldies" goldies --logo ~/Documents/cata/merchants/goldies/brand/logo.png
    python3 scaffold.py "The Berry Spot" tbs --domain theberryspot.sg
    python3 scaffold.py "Pizza Rimini" pr                      # no logo -> initials icon

After editing portal.config.json (new Tally form ID or data URL):
    python3 scaffold.py --refresh

Shared values (Tally form ID, data URL) come from portal.config.json — fill it in
before scaffolding. Per-merchant inputs are just: display name, slug, icon.
"""
import argparse
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TEMPLATE = ROOT / "template" / "index.html"
CONFIG = ROOT / "portal.config.json"
RESERVED = {"template", "apps-script", ".git", "node_modules"}


def load_config():
    if not CONFIG.exists():
        sys.exit(f"Missing {CONFIG.name} — create it with tally_form_id and data_url.")
    cfg = json.loads(CONFIG.read_text())
    placeholders = [k for k in ("tally_form_id", "data_url") if "PASTE_" in str(cfg.get(k, "PASTE_"))]
    if placeholders:
        sys.exit(
            f"portal.config.json still has placeholder values for: {', '.join(placeholders)}.\n"
            "Fill in the unified Tally form ID and the Apps Script web-app URL first (see README.md, One-time setup)."
        )
    return cfg


def initials_for(name):
    words = [w for w in re.split(r"\s+", name.strip()) if w]
    return "".join(w[0] for w in words[:2]).upper() or "?"


def new_site(args):
    if not re.fullmatch(r"[a-z0-9-]+", args.slug):
        sys.exit(f"Slug must be lowercase letters/digits/hyphens, got: {args.slug!r}")
    if args.slug in RESERVED:
        sys.exit(f"Slug {args.slug!r} is reserved.")
    dest = ROOT / args.slug
    if dest.exists() and not args.force:
        sys.exit(f"{dest} already exists — pass --force to overwrite its index.html.")

    cfg = load_config()
    html = TEMPLATE.read_text()

    # icon: local logo file > favicon-by-domain > initials
    if args.logo:
        logo_src = Path(args.logo).expanduser()
        if not logo_src.exists():
            sys.exit(f"Logo file not found: {logo_src}")
        icon_inner = f'<img src="logo{logo_src.suffix}" alt="{args.name}" />'
    elif args.domain:
        icon_inner = f'<img src="https://www.google.com/s2/favicons?domain={args.domain}&sz=128" alt="{args.name}" />'
    else:
        icon_inner = (
            f'<span style="font-size:12px;font-weight:800;color:#212121">'
            f"{args.initials or initials_for(args.name)}</span>"
        )
    html, n = re.subn(
        r'<div class="merchant-icon"[^>]*>.*?</div>',
        f'<div class="merchant-icon" style="background:{args.icon_bg};">{icon_inner}</div>',
        html,
        count=1,
    )
    if n != 1:
        sys.exit("Template drift: merchant-icon block not found — check template/index.html.")

    html = html.replace("[MERCHANT NAME]", args.name)
    html = html.replace("MERCHANT_SLUG", args.slug)
    html = html.replace("TALLY_FORM_ID", cfg["tally_form_id"])
    html = html.replace("DATA_URL_HERE", cfg["data_url"])
    html = re.sub(r"<!-- REPLACE:.*?-->", "", html)  # drop template-only instructions

    leftovers = [t for t in ("MERCHANT_", "TALLY_FORM_ID", "DATA_URL_HERE", "[MERCHANT") if t in html]
    if leftovers:
        sys.exit(f"Unreplaced placeholders remain ({leftovers}) — template and scaffold are out of sync.")

    dest.mkdir(exist_ok=True)
    (dest / "index.html").write_text(html)
    if args.logo:
        shutil.copy(logo_src, dest / f"logo{logo_src.suffix}")

    print(f"Created {dest.relative_to(ROOT)}/")
    print(f"  Portal URL (after push): https://cata-feedback.vercel.app/{args.slug}")
    print(f"  Form pre-fill check:     tally.so/embed/{cfg['tally_form_id']}?merchant={args.slug}")
    print("Next: git add, commit, and push (push publishes the site).")


def refresh():
    cfg = load_config()
    updated, skipped = [], []
    for d in sorted(p for p in ROOT.iterdir() if p.is_dir() and p.name not in RESERVED):
        page = d / "index.html"
        if not page.exists():
            continue
        html = page.read_text()
        if "const PORTAL={" not in html:
            skipped.append(d.name)  # legacy v1 site (own sheet+form) — migrate by re-scaffolding
            continue
        html = re.sub(r"dataUrl:'[^']*'", lambda m: f"dataUrl:'{cfg['data_url']}'", html)
        html = re.sub(r"(tally\.so/embed/)[A-Za-z0-9_]+", lambda m: m.group(1) + cfg["tally_form_id"], html)
        page.write_text(html)
        updated.append(d.name)
    print(f"Refreshed shared config in: {', '.join(updated) or '(none)'}")
    if skipped:
        print(f"Skipped legacy v1 sites (re-scaffold to migrate): {', '.join(skipped)}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("name", nargs="?", help='Merchant display name, e.g. "Box Coffee"')
    ap.add_argument("slug", nargs="?", help="URL slug / folder name, e.g. bc")
    ap.add_argument("--logo", help="Path to a logo image; copied into the merchant folder")
    ap.add_argument("--domain", help="Merchant website domain — icon uses its favicon")
    ap.add_argument("--initials", help="Override the initials shown when no logo/domain is given")
    ap.add_argument("--icon-bg", default="#F2E3D8", help="Icon background color (default %(default)s)")
    ap.add_argument("--force", action="store_true", help="Overwrite an existing merchant folder")
    ap.add_argument("--refresh", action="store_true", help="Re-apply portal.config.json to all v2 sites")
    args = ap.parse_args()

    if args.refresh:
        refresh()
    elif args.name and args.slug:
        new_site(args)
    else:
        ap.error("Provide NAME and SLUG to scaffold, or --refresh.")


if __name__ == "__main__":
    main()
