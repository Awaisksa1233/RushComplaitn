"""
Manual Daily Free-Wash Funnel Runner (Portal Signups with 0 Washes)
===================================================================
Rules Enforced:
- Local MongoDB connection only (mongodb://127.0.0.1:27017/rushwash)
- Funnel Entry starts strictly with Free Wash (Rule 10)
- Approved Template: 'firstwash' (Arabic, no vars, 7-day FIRSTWASH code)
- Audience: Portal signups ('portal-signup') created >= Sep 1, 2026 AST
- Volume: Exactly 100 customers/day (up to 50 New <24h, balance from Old Sep 1+ chronologically)
- Timestamps in Riyadh AST (Asia/Riyadh, UTC+3)
- Mandatory Vehicle License Plate in logs and outputs
- Arabic brand name: strictly 'رش واش'
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
from unifonic_app.config import MONGODB_URI
from unifonic_app.unifonic_client import format_e164_phone, send_whatsapp_message

AST_TZ = timezone(timedelta(hours=3))
SEP_1_2026_AST = datetime(2026, 9, 1, 0, 0, 0, tzinfo=AST_TZ)
DAILY_TARGET = 100
MAX_NEW_TARGET = 50
LOG_FILE = ROOT_DIR / "exports" / "portal_freewash_sent_log.csv"
DRY_RUN_FILE = ROOT_DIR / "exports" / "dry_run_freewash_today_100.csv"


def load_previously_sent() -> set:
    """Loads previously messaged customer codes and phones from the persistent sent log."""
    sent = set()
    if LOG_FILE.exists():
        with open(LOG_FILE, mode="r", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row in reader:
                code = (row.get("Customer Code") or "").strip()
                phone = (row.get("Phone Number") or "").strip()
                if code:
                    sent.add(code)
                if phone:
                    sent.add(format_e164_phone(phone))
    return sent


def build_cohort():
    """Builds the 100-customer cohort (New + Old chronologically from Sep 1, 2026)."""
    now_ast = datetime.now(timezone.utc).astimezone(AST_TZ)
    twenty_four_hours_ago = now_ast - timedelta(hours=24)

    client = pymongo.MongoClient(MONGODB_URI, serverSelectionTimeoutMS=3000)
    db = client.get_database("rushwash")

    # 1. Gather all customers who already washed
    wash_cust_ids = set(db.rushwash_wash_histories.distinct("customerId"))
    wash_plates = set(db.rushwash_wash_histories.distinct("normalizedPlate")) | set(db.rushwash_wash_histories.distinct("plateNumber"))

    # 2. Gather active/past subscribers
    sub_cust_ids = set(db.rushwash_subscriptions.distinct("customerId"))

    # 3. Build customer -> vehicle plate mapping
    vehicles = list(db.rushwash_vehicles.find({}, {"customerId": 1, "normalizedPlate": 1, "displayPlate": 1}))
    cust_vehicles = {}
    for v in vehicles:
        cid = v.get("customerId")
        disp = v.get("displayPlate") or v.get("normalizedPlate") or "No Plate"
        norm = v.get("normalizedPlate") or v.get("displayPlate") or ""
        if cid:
            cust_vehicles.setdefault(cid, []).append({"display": disp, "normalized": norm})

    # 4. Load already sent customers to prevent duplicates
    previously_sent = load_previously_sent()

    # 5. Query portal signups since Sep 1, 2026 AST
    query = {
        "createdAt": {"$gte": SEP_1_2026_AST},
        "createdById": "portal-signup",
        "phone": {"$exists": True, "$ne": ""}
    }
    candidates = list(db.rushwash_customers.find(query).sort("createdAt", 1))

    new_list = []
    old_list = []

    for c in candidates:
        cid = c["_id"]
        code = str(c.get("readableCode") or c.get("code") or cid)
        raw_phone = str(c.get("phone") or "").strip()
        e164 = format_e164_phone(raw_phone)

        # Exclude if already washed, subscribed, or previously messaged
        if cid in wash_cust_ids or cid in sub_cust_ids:
            continue
        if code in previously_sent or e164 in previously_sent:
            continue

        # Check vehicle plates for any washes
        v_list = cust_vehicles.get(cid, [])
        has_washed_plate = any(v["normalized"] in wash_plates for v in v_list if v["normalized"])
        if has_washed_plate:
            continue

        c_created = c.get("createdAt")
        if c_created.tzinfo is None:
            c_created = c_created.replace(tzinfo=timezone.utc)
        c_ast = c_created.astimezone(AST_TZ)

        primary_plate = v_list[0]["display"] if v_list else "No Plate Registered"
        name = f"{c.get('firstName') or ''} {c.get('lastName') or ''}".strip() or "Valued Customer"

        item = {
            "customerId": str(cid),
            "customerCode": code,
            "name": name,
            "phone": e164,
            "rawPhone": raw_phone,
            "plate": primary_plate,
            "createdAtAST": c_ast.strftime("%Y-%m-%d %I:%M %p"),
            "createdAtRaw": c_ast
        }

        if c_ast >= twenty_four_hours_ago:
            new_list.append(item)
        else:
            old_list.append(item)

    # Dynamic balancing: up to 50 New, remainder from Old chronologically
    selected_new = new_list[:MAX_NEW_TARGET]
    needed_old = DAILY_TARGET - len(selected_new)
    selected_old = old_list[:needed_old]

    for item in selected_new:
        item["segment"] = "NEW"
    for item in selected_old:
        item["segment"] = "OLD"

    final_cohort = selected_new + selected_old
    return final_cohort, len(new_list), len(old_list)


def main():
    parser = argparse.ArgumentParser(description="Manual Daily Free-Wash Funnel Runner for Portal Signups")
    parser.add_argument("--dry-run", action="store_true", default=True, help="Preview cohort without dispatching")
    parser.add_argument("--dispatch", action="store_true", help="Send messages via Unifonic")
    parser.add_argument("--confirm", action="store_true", help="Confirm execution for dispatch")
    args = parser.parse_args()

    now_ast = datetime.now(timezone.utc).astimezone(AST_TZ)
    print("=" * 80)
    print(f"🚀 RUSH CAR WASH (رش واش) — MANUAL FREE-WASH FUNNEL RUNNER")
    print(f"📅 Evaluation Time: {now_ast.strftime('%Y-%m-%d %I:%M:%S %p AST')}")
    print(f"🎯 Target Filter: Portal Signups (createdById: 'portal-signup') >= 2026-09-01 AST")
    print(f"🛡️  Redemption Gate: 0 Washes in rushwash_wash_histories, No Active Subscription")
    print("=" * 80)

    cohort, total_available_new, total_available_old = build_cohort()

    new_in_batch = sum(1 for c in cohort if c["segment"] == "NEW")
    old_in_batch = sum(1 for c in cohort if c["segment"] == "OLD")

    print(f"\n📊 COHORT COMPOSITION SUMMARY:")
    print(f"   • Available Un-messaged New (<24h): {total_available_new}")
    print(f"   • Available Un-messaged Old (Sep 1+): {total_available_old}")
    print(f"   • Selected in Today's Batch of {len(cohort)}:")
    print(f"       - NEW: {new_in_batch} (Capacity: {MAX_NEW_TARGET})")
    print(f"       - OLD: {old_in_batch} (Backfill from Sep 1 onwards)")
    print(f"       - TOTAL: {len(cohort)}")

    # Always write dry-run / batch CSV
    DRY_RUN_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(DRY_RUN_FILE, mode="w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "Segment", "Customer Code", "Customer Name", "Phone Number", "License Plate", "Signup Date (AST)"
        ])
        writer.writeheader()
        for c in cohort:
            writer.writerow({
                "Segment": c["segment"],
                "Customer Code": c["customerCode"],
                "Customer Name": c["name"],
                "Phone Number": c["phone"],
                "License Plate": c["plate"],
                "Signup Date (AST)": c["createdAtAST"]
            })

    print(f"\n📁 Batch CSV exported to: {DRY_RUN_FILE}")

    # Display sample
    print("\n📋 SAMPLE RECIPIENTS PREVIEW (First 5 New & First 5 Old):")
    sample_display = [c for c in cohort if c["segment"] == "NEW"][:5] + [c for c in cohort if c["segment"] == "OLD"][:5]
    print(f"{'SEGMENT':<6} | {'CODE':<10} | {'NAME':<20} | {'PHONE':<15} | {'PLATE':<14} | {'SIGNUP (AST)':<20}")
    print("-" * 95)
    for c in sample_display:
        print(f"{c['segment']:<6} | {c['customerCode']:<10} | {c['name'][:18]:<20} | {c['phone']:<15} | {c['plate']:<14} | {c['createdAtAST']:<20}")

    if args.dispatch and args.confirm:
        print("\n" + "=" * 80)
        print("📤 DISPATCHING MESSAGES VIA UNIFONIC...")
        print("Template: firstwash (Arabic, Code: FIRSTWASH, 7-Day Validity)")
        print("=" * 80)

        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        log_exists = LOG_FILE.exists()

        sent_count = 0
        fail_count = 0

        with open(LOG_FILE, mode="a", encoding="utf-8-sig", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=[
                "Customer Code", "Phone Number", "Customer Name", "Plate", "Segment", "Sent At AST", "Message ID", "Status"
            ])
            if not log_exists:
                writer.writeheader()

            for idx, c in enumerate(cohort, 1):
                res = send_whatsapp_message(
                    to_phone=c["phone"],
                    template_name="firstwash",
                    template_language="ar"
                )

                status = "SENT" if res.get("success") else "FAILED"
                msg_id = res.get("message_id") or ""
                if res.get("success"):
                    sent_count += 1
                else:
                    fail_count += 1

                writer.writerow({
                    "Customer Code": c["customerCode"],
                    "Phone Number": c["phone"],
                    "Customer Name": c["name"],
                    "Plate": c["plate"],
                    "Segment": c["segment"],
                    "Sent At AST": datetime.now(timezone.utc).astimezone(AST_TZ).strftime("%Y-%m-%d %I:%M:%S %p"),
                    "Message ID": msg_id,
                    "Status": status
                })

                print(f"[{idx:3d}/{len(cohort)}] {c['segment']:<3} | {c['customerCode']:<10} | {c['plate']:<14} | {c['phone']:<15} -> {status} (ID: {msg_id[:12]})")

        print("\n" + "=" * 80)
        print(f"🏁 DISPATCH COMPLETED: {sent_count} Sent Successfully, {fail_count} Failed.")
        print(f"📁 Logged in: {LOG_FILE}")
        print("=" * 80)

    else:
        print("\nℹ️  DRY RUN COMPLETED. No messages were sent.")
        print("   To dispatch, execute with: python -X utf8 scripts/run_daily_freewash_funnel.py --dispatch --confirm")


if __name__ == "__main__":
    main()
