"""
Sync Portal Free Wash Funnel (200 Dispatches & Redemptions) to rush_funnel
========================================================================
Supports:
  1. Local MongoDB (default: mongodb://127.0.0.1:27017/rush_funnel)
  2. VPS MongoDB (port 27018: mongodb://127.0.0.1:27018/rush_funnel)

All timestamps in Riyadh Time (AST) & normalized to UTC for MongoDB.
"""

import sys
import os
import csv
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path
from pymongo import MongoClient, UpdateOne

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

AST_TZ = timezone(timedelta(hours=3))

SENT_LOG_CSV = ROOT_DIR / "exports" / "portal_freewash_sent_log.csv"
TRACKING_LEDGER_CSV = ROOT_DIR / "exports" / "portal_freewash_tracking_ledger.csv"


def normalize_phone(phone_str):
    if not phone_str:
        return ""
    digits = re.sub(r"[^\d+]", "", str(phone_str))
    if digits.startswith("+"):
        digits = digits[1:]
    elif digits.startswith("00"):
        digits = digits[2:]
    elif digits.startswith("05") and len(digits) == 10:
        digits = "966" + digits[1:]
    elif digits.startswith("5") and len(digits) == 9:
        digits = "966" + digits
    if len(digits) == 12 and digits.startswith("966"):
        return "+" + digits
    return "+" + digits if digits else ""


def parse_sent_time(t_str):
    """Parses sent date string like '2026-11-10 16:53:39 AST' or '2026-11-11 01:36:18 PM'."""
    if not t_str:
        return datetime.now(timezone.utc)
    t_clean = t_str.replace(" AST", "").strip()
    # Try formats
    formats = [
        "%Y-%m-%d %I:%M:%S %p",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %I:%M %p",
        "%Y-%m-%d"
    ]
    for fmt in formats:
        try:
            dt = datetime.strptime(t_clean, fmt)
            # Interpreted as AST (UTC+3)
            dt_ast = dt.replace(tzinfo=AST_TZ)
            return dt_ast.astimezone(timezone.utc)
        except ValueError:
            continue
    # Default fallback
    return datetime.now(timezone.utc)


def parse_wash_time(t_str):
    """Parses wash date string like '2026-11-10 08:34 PM'."""
    if not t_str:
        return datetime.now(timezone.utc)
    formats = [
        "%Y-%m-%d %I:%M %p",
        "%Y-%m-%d %I:%M:%S %p",
        "%Y-%m-%d %H:%M:%S"
    ]
    for fmt in formats:
        try:
            dt = datetime.strptime(t_str.strip(), fmt)
            dt_ast = dt.replace(tzinfo=AST_TZ)
            return dt_ast.astimezone(timezone.utc)
        except ValueError:
            continue
    return datetime.now(timezone.utc)


def sync_funnel_db(mongo_uri="mongodb://127.0.0.1:27017/rush_funnel", label="Local MongoDB"):
    print(f"\n{'='*80}")
    print(f"  SYNCING PORTAL FREE WASH FUNNEL TO: {label}")
    print(f"  URI: {mongo_uri}")
    print(f"{'='*80}")

    if not SENT_LOG_CSV.exists():
        raise FileNotFoundError(f"Missing sent log CSV: {SENT_LOG_CSV}")
    if not TRACKING_LEDGER_CSV.exists():
        raise FileNotFoundError(f"Missing tracking ledger CSV: {TRACKING_LEDGER_CSV}")

    # Load tracking ledger for redemption status & wash details
    tracking_by_code = {}
    with open(TRACKING_LEDGER_CSV, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for r in reader:
            code = r.get("\ufeffCustomer Code") or r.get("Customer Code")
            if code:
                tracking_by_code[code.strip()] = r

    # Load sent log (200 records)
    sent_records = []
    with open(SENT_LOG_CSV, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for r in reader:
            code = r.get("\ufeffCustomer Code") or r.get("Customer Code")
            if code:
                sent_records.append(r)

    print(f"[*] Loaded {len(sent_records)} sent records from sent log.")
    print(f"[*] Loaded {len(tracking_by_code)} tracking records.")

    client = MongoClient(mongo_uri, serverSelectionTimeoutMS=5000)
    db = client.get_default_database() if client.get_default_database() is not None else client["rush_funnel"]
    now_utc = datetime.now(timezone.utc)

    # 1. Prepare funnel_messages ops
    msg_ops = []
    contact_ops = []
    event_ops = []

    redeemed_count = 0

    for r in sent_records:
        code = (r.get("\ufeffCustomer Code") or r.get("Customer Code", "")).strip()
        phone = normalize_phone(r.get("Phone Number", ""))
        name = r.get("Customer Name", "Valued Customer").strip()
        plate = r.get("Plate", "").strip()
        sent_ast_str = r.get("Sent At AST", "")
        sent_utc = parse_sent_time(sent_ast_str)
        mid = r.get("Message ID", "")
        date_tag = sent_utc.astimezone(AST_TZ).strftime("%Y%m%d")

        idempotency_key = f"firstwash-{date_tag}:{phone}"

        msg_doc = {
            "idempotencyKey": idempotency_key,
            "cohortGroup": "Portal_Freewash_Funnel",
            "createdAt": sent_utc,
            "customerCode": code,
            "customerName": name,
            "flowId": "mf-signup-coupon",
            "offerId": None,
            "phone": phone,
            "provider": "unifonic",
            "providerMessageId": mid,
            "providerMeta": {
                "unifonicMessageId": mid,
                "status": "SENT"
            },
            "status": "sent",
            "stepId": f"firstwash-{date_tag}",
            "templateId": "firstwash",
            "vehiclePlate": plate
        }
        msg_ops.append(
            UpdateOne(
                {"idempotencyKey": idempotency_key},
                {"$set": msg_doc},
                upsert=True
            )
        )

        # Contact and stages
        tr = tracking_by_code.get(code, {})
        is_redeemed = tr.get("Lifecycle Status") == "REDEEMED"
        wash_date_str = tr.get("First Wash Date AST", "")
        wash_utc = parse_wash_time(wash_date_str) if is_redeemed else None
        washed_plate = tr.get("Washed Plate") or plate

        current_stage = "free_wash_redeemed" if is_redeemed else "signed_up"
        stages_reached = {
            "signed_up": sent_utc.astimezone(AST_TZ).strftime("%Y-%m-%d %H:%M:%S")
        }
        if is_redeemed and wash_utc:
            stages_reached["free_wash_redeemed"] = wash_utc.astimezone(AST_TZ).strftime("%Y-%m-%d %H:%M:%S")
            redeemed_count += 1

        plates_list = []
        if plate and "no plate" not in plate.lower():
            plates_list.append(plate)
        if is_redeemed and washed_plate and washed_plate not in plates_list and "no plate" not in washed_plate.lower():
            plates_list.append(washed_plate)

        contact_doc_set = {
            "customerCode": code,
            "name": name,
            "currentStage": current_stage,
            "channel": "campaign",
            "lang": "ar",
            "stagesReached": stages_reached,
            "updatedAt": now_utc
        }
        if plates_list:
            contact_doc_set["plates"] = plates_list

        contact_ops.append(
            UpdateOne(
                {"phone": phone},
                {
                    "$set": contact_doc_set,
                    "$setOnInsert": {
                        "phone": phone,
                        "createdAt": sent_utc,
                        "consent": {"optedIn": True, "source": "portal_freewash_funnel", "at": now_utc.isoformat()}
                    }
                },
                upsert=True
            )
        )

        # Funnel events:
        # Event 1: signed_up (representing entrance into the funnel active window)
        ev_signup_id = f"signed_up:{code}"
        ev_signup_doc = {
            "eventId": ev_signup_id,
            "stageId": "signed_up",
            "contactKey": phone,
            "customerCode": code,
            "timestamp": sent_utc,
            "meta": {
                "source": "portal_freewash_funnel",
                "customerName": name,
                "plate": plate
            },
            "createdAt": now_utc
        }
        event_ops.append(
            UpdateOne(
                {"eventId": ev_signup_id},
                {"$set": ev_signup_doc},
                upsert=True
            )
        )

        # Event 2: free_wash_redeemed (if washed)
        if is_redeemed and wash_utc:
            ev_wash_id = f"free_wash_redeemed:{code}"
            ev_wash_doc = {
                "eventId": ev_wash_id,
                "stageId": "free_wash_redeemed",
                "contactKey": phone,
                "customerCode": code,
                "timestamp": wash_utc,
                "meta": {
                    "source": "branch_wash_redemption",
                    "customerName": name,
                    "plate": washed_plate,
                    "washDateAST": wash_date_str
                },
                "createdAt": now_utc
            }
            event_ops.append(
                UpdateOne(
                    {"eventId": ev_wash_id},
                    {"$set": ev_wash_doc},
                    upsert=True
                )
            )

    print(f"[*] Executing bulk writes...")
    if msg_ops:
        res_m = db.funnel_messages.bulk_write(msg_ops, ordered=False)
        print(f"  [+] funnel_messages: Upserted={len(res_m.upserted_ids)}, Modified={res_m.modified_count}, Matched={res_m.matched_count}")
    if contact_ops:
        res_c = db.funnel_contacts.bulk_write(contact_ops, ordered=False)
        print(f"  [+] funnel_contacts: Upserted={len(res_c.upserted_ids)}, Modified={res_c.modified_count}, Matched={res_c.matched_count}")
    if event_ops:
        res_e = db.funnel_events.bulk_write(event_ops, ordered=False)
        print(f"  [+] funnel_events: Upserted={len(res_e.upserted_ids)}, Modified={res_e.modified_count}, Matched={res_e.matched_count}")

    # Summary checks
    fw_msgs = db.funnel_messages.count_documents({"templateId": "firstwash"})
    all_evs = db.funnel_events.count_documents({"stageId": {"$in": ["signed_up", "free_wash_redeemed"]}})
    fw_redeemed_evs = db.funnel_events.count_documents({"stageId": "free_wash_redeemed"})
    print(f"\n[+] Verified DB State:")
    print(f"    Total 'firstwash' messages in DB: {fw_msgs}")
    print(f"    Total 'free_wash_redeemed' events in DB: {fw_redeemed_evs}")
    print(f"    Total 'signed_up' / 'free_wash_redeemed' events: {all_evs}")
    print(f"    Redeemed count in cohort: {redeemed_count}")
    print(f"{'='*80}\n")
    client.close()


def main():
    uri = sys.argv[1] if len(sys.argv) > 1 else "mongodb://127.0.0.1:27017/rush_funnel"
    label = sys.argv[2] if len(sys.argv) > 2 else "Local MongoDB (127.0.0.1:27017/rush_funnel)"
    sync_funnel_db(uri, label)


if __name__ == "__main__":
    main()
