"""
Update Campaign CMP-00033 & Coupon DSC-00666 with 100 New Customers
===================================================================
Replaces the previous 79 customer codes in CMP-00033 with the 100 new
customer codes and updates the promotion/coupon validity window to:
  Start: 2026-11-07 00:00:00 AST (2026-11-06 21:00:00.000 UTC)
  End:   2026-11-15 23:59:59.999 AST (2026-11-15 20:59:59.999 UTC)
"""

import os
import sys
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

from datetime import datetime, timezone, timedelta
from pathlib import Path
import pymongo
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))
load_dotenv(PROJECT_ROOT / ".env")

import csv

AST = timezone(timedelta(hours=3))
CAMPAIGN_CODE = "CMP-00033"
COUPON_CODE = "DSC-00666"

# Load all active customer codes from the persistent sent log (yesterday + today)
SENT_LOG = PROJECT_ROOT / "exports" / "portal_freewash_sent_log.csv"
if SENT_LOG.exists():
    with open(SENT_LOG, mode="r", encoding="utf-8-sig") as f:
        NEW_CODES_100 = list(dict.fromkeys([
            row["Customer Code"].strip() for row in csv.DictReader(f)
            if row.get("Customer Code") and row.get("Status") == "SENT"
        ]))
else:
    BATCH_CSV = PROJECT_ROOT / "exports" / "dry_run_freewash_today_100.csv"
    if BATCH_CSV.exists():
        with open(BATCH_CSV, mode="r", encoding="utf-8-sig") as f:
            NEW_CODES_100 = [row["Customer Code"].strip() for row in csv.DictReader(f) if row.get("Customer Code")]
    else:
        print(f"[!] Error: neither {SENT_LOG} nor {BATCH_CSV} found!")
        sys.exit(1)

print(f"[*] Loaded {len(NEW_CODES_100)} active customer codes for {CAMPAIGN_CODE}")

# Validity covering rolling 7-day window:
# From 2026-11-10 00:00:00 AST (2026-11-09 21:00:00 UTC) to 2026-11-18 23:59:59.999 AST (2026-11-18 20:59:59.999 UTC)
LIVE_FROM_UTC = datetime(2026, 11, 9, 21, 0, 0)
LIVE_UNTIL_UTC = datetime(2026, 11, 18, 20, 59, 59, 999000)

def fmt_dt(dt):
    if isinstance(dt, datetime):
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(AST).strftime('%Y-%m-%d %H:%M:%S AST')
    return str(dt)

def update_db(db, label: str):
    print("=" * 70)
    print(f"  Updating {CAMPAIGN_CODE} & {COUPON_CODE} on {label}")
    print("=" * 70)

    cmp_doc = db["rushwash_crm_campaigns"].find_one({"readableCode": CAMPAIGN_CODE})
    if not cmp_doc:
        print(f"[!] Error: {CAMPAIGN_CODE} not found in {label} database.")
        sys.exit(1)

    old_codes = cmp_doc.get("audienceSource", {}).get("customerCodes") or []
    print(f"[*] Before update ({CAMPAIGN_CODE} on {label}):")
    print(f"    - Old customerCodes count: {len(old_codes)} ({old_codes[0] if old_codes else 'none'} .. {old_codes[-1] if old_codes else 'none'})")
    print(f"    - Old liveFrom:  {fmt_dt(cmp_doc.get('liveFrom'))}")
    print(f"    - Old liveUntil: {fmt_dt(cmp_doc.get('liveUntil'))}")

    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)

    cmp_update = {
        "audienceSource.type": "customers",
        "audienceSource.customerCodes": NEW_CODES_100,
        "audienceSnapshotCustomerCodes": NEW_CODES_100,
        "audienceSnapshottedAt": now_utc,
        "audienceCount": len(NEW_CODES_100),
        "liveFrom": LIVE_FROM_UTC,
        "liveUntil": LIVE_UNTIL_UTC,
        "status": "live",
        "endedAt": None,
        "updatedAt": now_utc
    }

    res_cmp = db["rushwash_crm_campaigns"].update_one(
        {"readableCode": CAMPAIGN_CODE},
        {"$set": cmp_update}
    )

    dsc_update = {
        "redeemableFrom": LIVE_FROM_UTC,
        "redeemableUntil": LIVE_UNTIL_UTC,
        "status": "active",
        "updatedAt": now_utc
    }

    res_dsc = db["rushwash_discounts"].update_one(
        {"readableCode": COUPON_CODE},
        {"$set": dsc_update}
    )

    updated_cmp = db["rushwash_crm_campaigns"].find_one({"readableCode": CAMPAIGN_CODE})
    updated_dsc = db["rushwash_discounts"].find_one({"readableCode": COUPON_CODE})
    new_codes = updated_cmp.get("audienceSource", {}).get("customerCodes") or []

    print(f"\n[+] After update ({label}):")
    print(f"    - {CAMPAIGN_CODE} matched={res_cmp.matched_count}, modified={res_cmp.modified_count}")
    print(f"    - New customerCodes count: {len(new_codes)} ({new_codes[0]} .. {new_codes[-1]})")
    print(f"    - New snapshot count:      {len(updated_cmp.get('audienceSnapshotCustomerCodes') or [])}")
    print(f"    - New audienceCount:       {updated_cmp.get('audienceCount')}")
    print(f"    - New liveFrom:            {fmt_dt(updated_cmp.get('liveFrom'))} (UTC: {updated_cmp.get('liveFrom')})")
    print(f"    - New liveUntil:           {fmt_dt(updated_cmp.get('liveUntil'))} (UTC: {updated_cmp.get('liveUntil')})")
    print(f"    - Status:                  {updated_cmp.get('status')}")
    if updated_dsc:
        print(f"    - {COUPON_CODE} matched={res_dsc.matched_count}, modified={res_dsc.modified_count}")
        print(f"    - Coupon redeemableFrom:   {fmt_dt(updated_dsc.get('redeemableFrom'))}")
        print(f"    - Coupon redeemableUntil:  {fmt_dt(updated_dsc.get('redeemableUntil'))}")
        print(f"    - Coupon status:           {updated_dsc.get('status')}")

def main():
    target = sys.argv[1].lower() if len(sys.argv) > 1 else "both"

    if target in ("local", "both"):
        local_uri = os.getenv("MONGODB_URI", "mongodb://127.0.0.1:27017/rushwash")
        local_client = pymongo.MongoClient(local_uri, serverSelectionTimeoutMS=5000)
        update_db(local_client.get_database("rushwash"), "LOCAL MONGODB")

    if target in ("atlas", "prod", "both"):
        try:
            import dns.resolver
            resolver = dns.resolver.Resolver()
            resolver.nameservers = ['8.8.8.8', '1.1.1.1']
            dns.resolver.default_resolver = resolver
        except Exception:
            pass
        atlas_uri = os.getenv("ATLAS_URI")
        if not atlas_uri:
            print("[!] Error: ATLAS_URI not configured in .env")
            sys.exit(1)
        atlas_client = pymongo.MongoClient(atlas_uri, serverSelectionTimeoutMS=15000)
        update_db(atlas_client.get_database("rushwash"), "PRODUCTION ATLAS")

if __name__ == "__main__":
    main()
