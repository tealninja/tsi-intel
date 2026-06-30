#!/usr/bin/env python3
"""
TSI Intel — seed loader.

Reads the git seed (seed_accounts/contacts/products.json) + the reconciliation
worksheet (enrichment_crosswalk.json) and builds a populated SQLite database
against schema.sql. The git seed stays the source of truth ("staging"); this
loader is idempotent — re-running rebuilds the db from scratch.

Usage:  python3 load_seed.py [out.db]     (default: tsi-intel.db)
"""
import json, sqlite3, sys, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
def p(name): return os.path.join(HERE, name)

OUT = sys.argv[1] if len(sys.argv) > 1 else p("tsi-intel.db")
OWNER_EMAIL = "teal.john@gmail.com"   # sole owner in the export

def load(name): return json.load(open(p(name)))

def active(status): return 1 if (status or "").lower() == "active" else 0

def main():
    accounts = load("seed_accounts.json")
    contacts = load("seed_contacts.json")
    products = load("seed_products.json")
    crosswalk = load("enrichment_crosswalk.json")

    if os.path.exists(OUT):
        os.remove(OUT)
    con = sqlite3.connect(OUT)
    con.executescript(open(p("schema.sql")).read())
    # Disable FK *enforcement* during bulk load (rows can reference parents that
    # appear later in the file); integrity is re-verified via foreign_key_check.
    con.execute("PRAGMA foreign_keys = OFF")

    # ── users (owners -> users; all 'John Teal' here) ──────────────────────
    owners = {}
    def owner_id(name):
        if not name: return None
        if name not in owners:
            uid = len(owners) + 1
            email = OWNER_EMAIL if name == "John Teal" else None
            con.execute("INSERT INTO users(id,name,email) VALUES(?,?,?)", (uid, name, email))
            owners[name] = uid
        return owners[name]

    # ── organizations (374 seed rows) ──────────────────────────────────────
    for a in accounts:
        street = ", ".join(x for x in (a.get("street1"), a.get("street2")) if x) or None
        con.execute("""INSERT INTO organizations
            (seed_id,dynamics_id,name,formal_name,owner_id,account_type,parent_seed_id,
             address_street,address_locality,address_admin_area,address_postal_code,
             address_country,phone,website,about,active_flag,add_time,update_time)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (a["seed_id"], a.get("dynamics_id"), a["name"], a.get("formal_name"),
             owner_id(a.get("owner")), a.get("account_type"), a.get("parent_seed_id"),
             street, a.get("city"), a.get("state"), a.get("postal_code"),
             a.get("country"), a.get("phone"), a.get("website"),
             a.get("description") or a.get("notes"),
             active(a.get("status")), a.get("created_on"), a.get("modified_on")))

    # ── apply crosswalk: enrich existing + add net-new seed-origin rows ─────
    def num(v):
        try: return float(v)
        except (TypeError, ValueError): return None
    enriched = added = 0
    for c in crosswalk:
        carry = c.get("carry") or {}
        vals = (carry.get("acctMatch"), num(carry.get("lat")), num(carry.get("lon")),
                carry.get("plantType"), carry.get("industry"))
        if c["action"] == "enrich" and c["seed_id"]:
            con.execute("""UPDATE organizations SET
                acct_match=COALESCE(?,acct_match), lat=COALESCE(?,lat), lon=COALESCE(?,lon),
                plant_type=COALESCE(?,plant_type), industry=COALESCE(?,industry)
                WHERE seed_id=?""", (*vals, c["seed_id"]))
            enriched += 1
        elif c["action"] == "add":
            con.execute("""INSERT INTO organizations
                (seed_id,name,owner_id,account_type,parent_seed_id,
                 acct_match,lat,lon,plant_type,industry,active_flag)
                VALUES(?,?,?,?,?,?,?,?,?,?,1)""",
                (c["seed_id"], c["name"], owner_id("John Teal"), "unclassified",
                 c.get("parent_seed_id"), *vals))
            added += 1

    # ── persons + emails/phones + org membership ───────────────────────────
    for c in contacts:
        con.execute("""INSERT INTO persons
            (seed_id,dynamics_id,name,first_name,last_name,job_title,owner_id,
             match_type,company_name_raw,active_flag,add_time,update_time)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
            (c["seed_id"], c.get("dynamics_id"), c["full_name"], c.get("first_name"),
             c.get("last_name"), c.get("job_title"), owner_id(c.get("owner")),
             c.get("match_type"), c.get("company_name_raw"),
             active(c.get("status")), c.get("created_on"), c.get("modified_on")))
        if c.get("email"):
            con.execute("INSERT INTO person_emails(person_seed_id,label,value,is_primary) VALUES(?,?,?,1)",
                        (c["seed_id"], "work", c["email"]))
        # business primary when present, else mobile
        bus, mob = c.get("business_phone"), c.get("mobile_phone")
        if bus:
            con.execute("INSERT INTO person_phones(person_seed_id,label,value,is_primary) VALUES(?,?,?,1)",
                        (c["seed_id"], "work", bus))
        if mob:
            con.execute("INSERT INTO person_phones(person_seed_id,label,value,is_primary) VALUES(?,?,?,?)",
                        (c["seed_id"], "mobile", mob, 0 if bus else 1))
        if c.get("matched_account_seed_id"):
            con.execute("""INSERT INTO person_organizations(person_seed_id,org_seed_id,is_primary)
                           VALUES(?,?,1)""", (c["seed_id"], c["matched_account_seed_id"]))

    # ── products (prices left empty until manually entered) ─────────────────
    for pr in products:
        con.execute("""INSERT INTO products
            (seed_id,name,code,category,structure,parent_seed_id,active_flag)
            VALUES(?,?,?,?,?,?,?)""",
            (pr["seed_id"], pr["name"], pr.get("pn"), pr.get("category"),
             pr.get("structure"), pr.get("parent_seed_id"), active(pr.get("status"))))

    con.commit()
    report(con, accounts, contacts, products, enriched, added)
    con.close()

def report(con, accounts, contacts, products, enriched, added):
    q = lambda s: con.execute(s).fetchone()[0]
    print(f"\n── load complete → {OUT} ──")
    print(f"users                 {q('SELECT COUNT(*) FROM users')}")
    print(f"organizations         {q('SELECT COUNT(*) FROM organizations')}  "
          f"(seed {len(accounts)} + new {added}; enriched {enriched})")
    print(f"  with geo (lat)      {q('SELECT COUNT(*) FROM organizations WHERE lat IS NOT NULL')}")
    print(f"  with acct_match     {q('SELECT COUNT(*) FROM organizations WHERE acct_match IS NOT NULL')}")
    print(f"persons               {q('SELECT COUNT(*) FROM persons')}  (seed {len(contacts)})")
    print(f"  person_emails       {q('SELECT COUNT(*) FROM person_emails')}")
    print(f"  person_phones       {q('SELECT COUNT(*) FROM person_phones')}")
    print(f"  org memberships     {q('SELECT COUNT(*) FROM person_organizations')}  "
          f"(standalone {q('SELECT COUNT(*) FROM persons p WHERE NOT EXISTS (SELECT 1 FROM person_organizations po WHERE po.person_seed_id=p.seed_id)')})")
    print(f"products              {q('SELECT COUNT(*) FROM products')}  (seed {len(products)})")

    # integrity: FK violations (should be none)
    viol = con.execute("PRAGMA foreign_key_check").fetchall()
    print(f"\nFK violations         {len(viol)}")

    # spot-join: a known account with its contacts
    print("\nspot-check — West Fraser (acct_0350) contacts via join:")
    rows = con.execute("""SELECT p.name, p.job_title FROM persons p
        JOIN person_organizations po ON po.person_seed_id=p.seed_id
        WHERE po.org_seed_id='acct_0350' LIMIT 5""").fetchall()
    for r in rows: print(f"    {r[0]} — {r[1]}")
    if not rows: print("    (none linked)")

    # the 15 net-new seed-origin rows
    print("\nnet-new seed-origin orgs (acct_0375+):")
    for r in con.execute("""SELECT seed_id,name,parent_seed_id,plant_type FROM organizations
                            WHERE seed_id>='acct_0375' ORDER BY seed_id"""):
        print(f"    {r[0]}  {r[1]:<26} parent={r[2] or '-':<11} plant={r[3] or '-'}")

    # pipeline linkage: every opp's acct string must resolve to an org via
    # acct_match/name (exact, or prefix — the app's loose resolver semantics).
    html = open(p("tsi-intel.html")).read()
    pipe = json.loads(re.search(r'const _PIPELINE = (\[.*?\}\]);', html, re.S).group(1))
    accts = sorted({x["acct"] for x in pipe})
    aliases = [r[0] for r in con.execute("SELECT acct_match FROM organizations WHERE acct_match IS NOT NULL")]
    names = {r[0] for r in con.execute("SELECT name FROM organizations")}
    def resolves(a):
        if a in names or a in aliases: return True
        return any(m and (a.startswith(m) or m.startswith(a)) for m in aliases)
    unres = [a for a in accts if not resolves(a)]
    print(f"\npipeline acct resolution   {len(accts)-len(unres)}/{len(accts)} resolve via acct_match/name")
    if unres:
        print(f"  unresolved (need alias)  {unres}")

if __name__ == "__main__":
    main()
