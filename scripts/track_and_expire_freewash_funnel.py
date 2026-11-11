"""
Portal Free-Wash Funnel Lifecycle Tracker & Day 7 Expiration Engine
===================================================================
Rules Enforced:
- Enforces Rule 10 (rush-funnel-rules): Free Wash gate, Day 5 reminder, Day 7 strict exit.
- Checks rushwash_wash_histories (both customerId and license plates) for redemptions.
- If unredeemed after 7 days, REMOVES customer from Atlas/Local CMP-00033 snapshot
  so the promo code cannot be redeemed past the 7-day voucher validity.
- Timestamps in Riyadh AST (Asia/Riyadh, UTC+3).
- Outputs include customer vehicle license plates.
"""

import sys
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

import os
import csv
import argparse
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

import pymongo
from dotenv import load_dotenv
load_dotenv(ROOT_DIR / ".env")

from unifonic_app.config import MONGODB_URI

AST_TZ = timezone(timedelta(hours=3))
CAMPAIGN_CODE = "CMP-00033"
COUPON_CODE = "DSC-00666"

SENT_LOG = ROOT_DIR / "exports" / "portal_freewash_sent_log.csv"
TRACKING_LEDGER = ROOT_DIR / "exports" / "portal_freewash_tracking_ledger.csv"


def parse_ast_date(dt_str: str) -> datetime:
    """Parses date string formatted as '%Y-%m-%d %I:%M:%S %p' or '%Y-%m-%d' into AST timezone."""
    dt_str = dt_str.strip()
    for fmt in ("%Y-%m-%d %I:%M:%S %p", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            d = datetime.strptime(dt_str, fmt)
            return d.replace(tzinfo=AST_TZ)
        except ValueError:
            pass
    return datetime.now(AST_TZ)


def get_local_db():
    client = pymongo.MongoClient(MONGODB_URI, serverSelectionTimeoutMS=3000)
    return client.get_database("rushwash")


def get_atlas_db():
    atlas_uri = os.getenv("ATLAS_URI")
    if not atlas_uri:
        return None
    try:
        import dns.resolver
        resolver = dns.resolver.Resolver()
        resolver.nameservers = ['8.8.8.8', '1.1.1.1']
        dns.resolver.default_resolver = resolver
    except Exception:
        pass
    client = pymongo.MongoClient(atlas_uri, serverSelectionTimeoutMS=10000)
    return client.get_database("rushwash")


def remove_customers_from_campaign(db, customer_codes: list, label: str):
    """Pulls expired unredeemed customer codes from the campaign snapshot array in MongoDB."""
    if not customer_codes:
        return
    res = db["rushwash_crm_campaigns"].update_one(
        {"readableCode": CAMPAIGN_CODE},
        {
            "$pull": {
                "audienceSnapshotCustomerCodes": {"$in": customer_codes},
                "audienceSource.customerCodes": {"$in": customer_codes}
            },
            "$set": {
                "updatedAt": datetime.now(timezone.utc)
            }
        }
    )
    # Recalculate audienceCount
    doc = db["rushwash_crm_campaigns"].find_one({"readableCode": CAMPAIGN_CODE})
    if doc:
        remaining = len(doc.get("audienceSnapshotCustomerCodes") or [])
        db["rushwash_crm_campaigns"].update_one(
            {"readableCode": CAMPAIGN_CODE},
            {"$set": {"audienceCount": remaining}}
        )
        print(f"[+] [{label}] Removed {len(customer_codes)} expired codes from {CAMPAIGN_CODE}. Remaining active: {remaining}")


def audit_and_track(apply_removals: bool = False):
    now_ast = datetime.now(timezone.utc).astimezone(AST_TZ)
    print("=" * 80)
    print(f"📊 PORTAL FREE-WASH LIFECYCLE TRACKER & EXPIRATION AUDIT")
    print(f"📅 Audit Time: {now_ast.strftime('%Y-%m-%d %I:%M:%S %p AST')}")
    print("=" * 80)

    if not SENT_LOG.exists():
        print(f"[!] Sent log {SENT_LOG} does not exist yet.")
        return

    # Read sent records
    sent_records = []
    with open(SENT_LOG, mode="r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row.get("Status") == "SENT":
                sent_records.append(row)

    print(f"[*] Total Dispatched Free-Wash Records: {len(sent_records)}")

    # Connect to Local DB for wash lookups
    db = get_local_db()

    # Pre-fetch washes and vehicles for speed
    all_washes = list(db.rushwash_wash_histories.find(
        {"washDate": {"$gte": datetime(2026, 9, 1)}},
        {"customerId": 1, "plateNumber": 1, "normalizedPlate": 1, "washDate": 1}
    ))
    wash_by_cust = {}
    wash_by_plate = {}
    for w in all_washes:
        cid = str(w.get("customerId") or "")
        p1 = str(w.get("plateNumber") or "").strip()
        p2 = str(w.get("normalizedPlate") or "").strip()
        w_date = w.get("washDate")
        if cid:
            wash_by_cust.setdefault(cid, []).append((w_date, p1 or p2))
        if p1:
            wash_by_plate.setdefault(p1, []).append(w_date)
        if p2:
            wash_by_plate.setdefault(p2, []).append(w_date)

    # Pre-fetch customer vehicles
    vehicles = list(db.rushwash_vehicles.find({}, {"customerId": 1, "customerCode": 1, "displayPlate": 1, "normalizedPlate": 1}))
    plates_by_code = {}
    plates_by_cid = {}
    for v in vehicles:
        code = str(v.get("customerCode") or "")
        cid = str(v.get("customerId") or "")
        disp = v.get("displayPlate") or v.get("normalizedPlate") or ""
        norm = v.get("normalizedPlate") or v.get("displayPlate") or ""
        if code and disp:
            plates_by_code.setdefault(code, set()).add((disp, norm))
        if cid and disp:
            plates_by_cid.setdefault(cid, set()).add((disp, norm))

    # Pre-fetch customer IDs by code
    customers = list(db.rushwash_customers.find(
        {"readableCode": {"$in": [r["Customer Code"] for r in sent_records]}},
        {"readableCode": 1, "_id": 1}
    ))
    cid_by_code = {c.get("readableCode"): str(c["_id"]) for c in customers}

    # Tracking rows
    ledger_rows = []
    codes_to_expire = []
    redeemed_count = 0
    pending_count = 0
    d5_due_count = 0
    expired_count = 0

    for r in sent_records:
        code = r["Customer Code"]
        phone = r["Phone Number"]
        name = r["Customer Name"]
        plate = r.get("Plate") or "No Plate Registered"
        segment = r.get("Segment") or "UNKNOWN"
        sent_at_ast = parse_ast_date(r["Sent At AST"])

        d5_date_ast = sent_at_ast + timedelta(days=5)
        d7_expiry_ast = sent_at_ast + timedelta(days=7, hours=23, minutes=59)

        cid = cid_by_code.get(code)
        
        # Check washes
        user_washes = []
        if cid and cid in wash_by_cust:
            user_washes.extend(wash_by_cust[cid])

        # Check vehicle plates
        v_plates = plates_by_code.get(code, set())
        if cid and cid in plates_by_cid:
            v_plates |= plates_by_cid[cid]

        for disp_p, norm_p in v_plates:
            if disp_p in wash_by_plate:
                user_washes.extend([(dt, disp_p) for dt in wash_by_plate[disp_p]])
            if norm_p in wash_by_plate:
                user_washes.extend([(dt, norm_p) for dt in wash_by_plate[norm_p]])

        # Filter washes that happened on or after sent date
        valid_redemptions = [w for w in user_washes if w[0] and (w[0].tzinfo or timezone.utc) >= sent_at_ast - timedelta(days=1)]

        status = "PENDING"
        first_wash_date = ""
        washed_plate = ""

        if valid_redemptions:
            status = "REDEEMED"
            redeemed_count += 1
            earliest_wash = min(valid_redemptions, key=lambda x: x[0])
            first_wash_date = earliest_wash[0].strftime("%Y-%m-%d %I:%M %p")
            washed_plate = earliest_wash[1]
        elif now_ast >= d7_expiry_ast:
            status = "EXPIRED_REMOVED"
            expired_count += 1
            codes_to_expire.append(code)
        elif now_ast >= d5_date_ast:
            status = "DAY_5_REMINDER_DUE"
            d5_due_count += 1
        else:
            status = "PENDING"
            pending_count += 1

        ledger_rows.append({
            "Customer Code": code,
            "Phone Number": phone,
            "Customer Name": name,
            "License Plate": plate,
            "Segment": segment,
            "Dispatched At AST": sent_at_ast.strftime("%Y-%m-%d %I:%M %p"),
            "Day 5 Reminder Date AST": d5_date_ast.strftime("%Y-%m-%d"),
            "Day 7 Expiry Date AST": d7_expiry_ast.strftime("%Y-%m-%d %I:%M %p"),
            "Lifecycle Status": status,
            "First Wash Date AST": first_wash_date,
            "Washed Plate": washed_plate
        })

    # Save to TRACKING_LEDGER
    TRACKING_LEDGER.parent.mkdir(parents=True, exist_ok=True)
    with open(TRACKING_LEDGER, mode="w", encoding="utf-8-sig", newline="") as f:
        fieldnames = [
            "Customer Code", "Phone Number", "Customer Name", "License Plate", "Segment",
            "Dispatched At AST", "Day 5 Reminder Date AST", "Day 7 Expiry Date AST",
            "Lifecycle Status", "First Wash Date AST", "Washed Plate"
        ]
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(ledger_rows)

    print(f"\n📈 LIFECYCLE STATUS SUMMARY:")
    print(f"   • Active / Pending (Inside 7-day window): {pending_count}")
    print(f"   • Day 5 Reminder Due (Day 5 to 7):        {d5_due_count}")
    print(f"   • Redeemed Free Wash (Cleared Gate):      {redeemed_count}")
    print(f"   • Expired Unredeemed (Day 7+ Expiry):     {expired_count}")
    print(f"\n📁 Ledger saved to: {TRACKING_LEDGER}")

    # If there are expirations to process and flag is set
    if codes_to_expire and apply_removals:
        print(f"\n[!] Processing Day 7 removals for {len(codes_to_expire)} unredeemed customers...")
        remove_customers_from_campaign(db, codes_to_expire, "LOCAL MONGODB")
        atlas_db = get_atlas_db()
        if atlas_db:
            remove_customers_from_campaign(atlas_db, codes_to_expire, "PRODUCTION ATLAS")
        print("[+] Day 7 removals completed.")
    elif codes_to_expire:
        print(f"\n[i] {len(codes_to_expire)} customers have exceeded Day 7. Run with --apply-removals to deactivate in Atlas.")
    else:
        print(f"\n[✓] All customers are currently within their active voucher window. Zero expired records today.")


def main():
    parser = argparse.ArgumentParser(description="Track and expire portal freewash funnel recipients.")
    parser.add_argument("--apply-removals", action="store_true", help="Remove expired unredeemed customers from Atlas CMP-00033 snapshot")
    args = parser.parse_args()

    audit_and_track(apply_removals=args.apply_removals)


if __name__ == "__main__":
    main()
