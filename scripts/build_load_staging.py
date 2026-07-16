#!/usr/bin/env python3
"""
build_load_staging.py — generate scripts/load_staging.sql from the seed JSON.

Reads seed_accounts.json / seed_contacts.json / seed_products.json PLUS
enrichment_crosswalk.json and emits batched INSERT statements into the staging_*
tables (migrations/001_staging.sql). Base staging rows mirror the RAW seed shape;
validation happens on the raw import first, and the transform into live tables lives
in migrations/003_promote.sql.

Enrichment (DECISION-1) is folded in at the staging layer:
  - the 15 'add' crosswalk entries are synthesized as extra staging_accounts rows
    (net-new seed-origin orgs acct_0375..acct_0389), so staging_accounts holds 389;
  - all 72 crosswalk entries emit a staging_enrichment row carrying the acct_match
    alias + geo/industry, which promotion LEFT JOINs onto organizations.

Every row is tagged load_batch='dynamics_2026_06_30' so the staging load is itself
re-runnable / clearable independently of the promotion.

This generator is deterministic and idempotent: same seed in -> byte-identical SQL out,
so the generated file can be committed and diffed.

Usage:  python scripts/build_load_staging.py
        (writes scripts/load_staging.sql next to the seed files' repo root)
"""

from pathlib import Path
import json

# Repo root is the parent of this scripts/ directory.
REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = REPO_ROOT / "scripts" / "load_staging.sql"
LOAD_BATCH = "dynamics_2026_06_30"
ROWS_PER_INSERT = 80  # keep each INSERT well under D1's statement/variable limits

# For each staging table: (table name, source JSON file, ordered column list).
# The column order here is the exact order values are emitted below. loaded_at is
# intentionally omitted so its DEFAULT (datetime('now')) fires on insert.
TABLES = {
    "staging_accounts": {
        "file": "seed_accounts.json",
        "cols": ["seed_id", "dynamics_id", "name", "phone", "website", "city",
                 "state", "country", "postal_code", "street1", "street2",
                 "description", "owner", "status", "created_on", "modified_on",
                 "account_type", "parent_account_name", "parent_seed_id",
                 "formal_name", "notes", "load_batch"],
    },
    "staging_contacts": {
        "file": "seed_contacts.json",
        "cols": ["seed_id", "dynamics_id", "full_name", "first_name", "last_name",
                 "email", "company_name_raw", "business_phone", "mobile_phone",
                 "job_title", "owner", "status", "created_on", "modified_on",
                 "matched_account", "matched_account_seed_id", "match_type",
                 "load_batch"],
    },
    "staging_products": {
        "file": "seed_products.json",
        "cols": ["seed_id", "pn", "name", "structure", "status", "category",
                 "price", "parent_seed_id", "load_batch"],
    },
}

# staging_enrichment is derived from enrichment_crosswalk.json, not a raw seed file.
ENRICHMENT_COLS = ["seed_id", "app_id", "acct_match", "industry", "lat", "lon",
                   "plant_type", "geo_source", "load_batch"]


def to_number(value):
    """Crosswalk lat/lon may arrive as strings; coerce to float or None."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def build_add_account_rows(crosswalk):
    """Synthesize staging_accounts rows for the 15 net-new 'add' crosswalk orgs.

    These orgs exist only in the crosswalk (app-only accounts, seed_id acct_0375+),
    so they have no CRM record: only a name, parent link, and a manual classification.
    status='Active' makes promotion set active_flag=1 (matching load_seed.py). All
    other seed columns are absent -> NULL. Their geo/industry/alias ride in
    staging_enrichment like every other enriched org.
    """
    rows = []
    for entry in crosswalk:
        if entry.get("action") != "add":
            continue
        rows.append({
            "seed_id": entry["seed_id"],
            "name": entry["name"],
            "account_type": "unclassified",
            "parent_seed_id": entry.get("parent_seed_id"),
            "status": "Active",
        })
    return rows


def build_enrichment_rows(crosswalk):
    """One staging_enrichment row per seed_id (crosswalk entries MERGED per org).

    The app modeled corporate + individual plant sites as separate accounts, and
    several collapse onto one seed org (e.g. West Fraser corporate + 4 site codes ->
    acct_0350). staging_enrichment keys on seed_id, so we merge each group:
      - acct_match : distinct aliases, newline-joined (a future D1 resolver splits and
                     exact/prefix-matches — mirrors the app's per-account alias check).
                     In this data every group's alias is identical, so it's one value.
      - industry   : first non-null (carried by the corporate AG-* entry).
      - plant_type : first non-null (carried by a site S-* entry).
      - lat/lon    : the first site's coordinate (deterministic by app_id). One org row
                     holds ONE coordinate, so extra sites' coordinates are dropped —
                     only West Fraser (4 sites) actually loses any (3 dropped). This is
                     inherent to collapsing the app's site-level model into the seed's
                     corporate org; a site-level table would be a separate enhancement.
      - geo_source : precomputed 'plant' when a coordinate is present, so the Worker's
                     address-geocoder never overwrites a precise app coordinate (DECISION-10).
    """
    groups = {}
    for entry in crosswalk:
        groups.setdefault(entry["seed_id"], []).append(entry)

    def first_non_null(entries, key):
        for e in entries:
            val = (e.get("carry") or {}).get(key)
            if val is not None and val != "":
                return val
        return None

    rows = []
    for seed_id, entries in groups.items():
        aliases = []
        for e in entries:
            alias = (e.get("carry") or {}).get("acctMatch")
            if alias and alias not in aliases:
                aliases.append(alias)

        geo_entries = sorted(
            (e for e in entries if to_number((e.get("carry") or {}).get("lat")) is not None),
            key=lambda e: e.get("app_id") or "")
        if geo_entries:
            lat = to_number(geo_entries[0]["carry"].get("lat"))
            lon = to_number(geo_entries[0]["carry"].get("lon"))
            geo_source = "plant"
        else:
            lat = lon = geo_source = None

        app_ids = ",".join(sorted(e["app_id"] for e in entries if e.get("app_id")))

        rows.append({
            "seed_id": seed_id,
            "app_id": app_ids or None,          # all source app ids for traceability
            "acct_match": "\n".join(aliases) if aliases else None,
            "industry": first_non_null(entries, "industry"),
            "lat": lat,
            "lon": lon,
            "plant_type": first_non_null(entries, "plantType"),
            "geo_source": geo_source,
        })
    return rows


def sql_literal(value):
    """Render a Python value as a safe SQLite literal.

    - None            -> NULL
    - int/float       -> bare number (price is REAL; everything else is TEXT)
    - everything else -> single-quoted string with quotes doubled (SQL escaping)
    """
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        # No booleans expected in the seed, but be explicit rather than silently 0/1.
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return repr(value)
    return "'" + str(value).replace("'", "''") + "'"


def emit_table(table_name, cols, rows):
    """Return the SQL text for one staging table: batched multi-row INSERTs."""
    lines = [f"\n-- {table_name}: {len(rows)} rows (load_batch = {LOAD_BATCH})"]
    header = f"INSERT INTO {table_name} ({', '.join(cols)}) VALUES"

    # Build one tuple of literals per source row. `load_batch` is a synthetic column
    # (not in the JSON), so it is injected as the constant batch tag.
    value_tuples = []
    for row in rows:
        literals = []
        for col in cols:
            if col == "load_batch":
                literals.append(sql_literal(LOAD_BATCH))
            else:
                literals.append(sql_literal(row.get(col)))
        value_tuples.append("(" + ", ".join(literals) + ")")

    # Chunk the tuples into batches so no single INSERT gets too large.
    for start in range(0, len(value_tuples), ROWS_PER_INSERT):
        chunk = value_tuples[start:start + ROWS_PER_INSERT]
        lines.append(header + "\n" + ",\n".join(chunk) + ";")

    return "\n".join(lines) + "\n"


def load_json(name):
    return json.loads((REPO_ROOT / name).read_text(encoding="utf-8"))


def main():
    seed_accounts = load_json("seed_accounts.json")
    seed_contacts = load_json("seed_contacts.json")
    seed_products = load_json("seed_products.json")
    crosswalk = load_json("enrichment_crosswalk.json")

    # staging_accounts = 374 raw seed rows + 15 synthesized net-new 'add' orgs.
    add_rows = build_add_account_rows(crosswalk)
    account_rows = seed_accounts + add_rows
    enrichment_rows = build_enrichment_rows(crosswalk)

    parts = [
        "-- scripts/load_staging.sql  (GENERATED by scripts/build_load_staging.py — do not edit by hand)",
        f"-- Source: seed_accounts.json (374) + {len(add_rows)} crosswalk 'add' orgs = {len(account_rows)} accounts;",
        f"--         seed_contacts.json ({len(seed_contacts)}) + seed_products.json ({len(seed_products)});",
        f"--         enrichment_crosswalk.json -> staging_enrichment ({len(enrichment_rows)}).",
        f"-- Every row tagged load_batch = '{LOAD_BATCH}'.",
        "-- Apply AFTER migrations/001_staging.sql:",
        "--   wrangler d1 execute tsi-intel --local  --file=scripts/load_staging.sql",
        "--   wrangler d1 execute tsi-intel --remote --file=scripts/load_staging.sql",
        "-- Re-runnable: clear first with",
        "--   DELETE FROM staging_accounts; DELETE FROM staging_enrichment;",
        "--   DELETE FROM staging_contacts; DELETE FROM staging_products;",
        "",
    ]

    parts.append(emit_table("staging_accounts", TABLES["staging_accounts"]["cols"], account_rows))
    parts.append(emit_table("staging_enrichment", ENRICHMENT_COLS, enrichment_rows))
    parts.append(emit_table("staging_contacts", TABLES["staging_contacts"]["cols"], seed_contacts))
    parts.append(emit_table("staging_products", TABLES["staging_products"]["cols"], seed_products))

    OUT_PATH.write_text("\n".join(parts), encoding="utf-8")

    # Console summary so the run is self-verifying.
    print(f"wrote {OUT_PATH.relative_to(REPO_ROOT)}")
    print(f"  staging_accounts   {len(account_rows)} rows (374 seed + {len(add_rows)} net-new)")
    print(f"  staging_enrichment {len(enrichment_rows)} rows")
    print(f"  staging_contacts   {len(seed_contacts)} rows")
    print(f"  staging_products   {len(seed_products)} rows")


if __name__ == "__main__":
    main()
