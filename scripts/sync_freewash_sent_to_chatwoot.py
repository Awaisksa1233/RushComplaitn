"""
Sync Dispatched Free-Wash Campaign Messages to Chatwoot
======================================================
Reads exports/portal_freewash_sent_log.csv and syncs each outbound WhatsApp
message into Chatwoot so agents can see the customer's full campaign history.
Updates Chatwoot Synced status in the sent log.
"""

import sys
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

import os
import csv
import time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from unifonic_app.chatwoot_bridge import sync_outbound_to_chatwoot, format_phone_for_chatwoot

SENT_LOG = ROOT_DIR / "exports" / "portal_freewash_sent_log.csv"

FIRSTWASH_TEXT = (
    "حياك الله في رش! غسلتك الأولى علينا. "
    "استخدم الرمز FIRSTWASH عند مسار المبيعات خلال ٧ أيام واستمتع بغسلة نانو + تنظيف داخلي مجاناً."
)


def sync_single_customer(row):
    code = row.get("Customer Code")
    phone = row.get("Phone Number")
    name = row.get("Customer Name") or "Valued Customer"
    plate = row.get("Plate") or ""
    msg_id = row.get("Message ID") or ""
    status = row.get("Status")

    if status != "SENT":
        return code, False, "not_sent"

    # Display name formatted with vehicle plate if available
    display_name = name
    if plate and plate != "No Plate Registered":
        display_name = f"{name} ({plate})"

    try:
        res = sync_outbound_to_chatwoot(
            to_phone=phone,
            content=FIRSTWASH_TEXT,
            message_id=msg_id,
            sender_name="Rush Wash Automation",
            campaign_name="portal_freewash_firstwash",
            customer_name=display_name
        )
        if res:
            return code, True, "synced"
        else:
            return code, False, "chatwoot_api_none"
    except Exception as e:
        return code, False, str(e)


def main():
    print("=" * 80)
    print("🔄 SYNCING PORTAL FREE-WASH DISPATCH LOG TO CHATWOOT")
    print(f"📁 Log Source: {SENT_LOG}")
    print("=" * 80)

    if not SENT_LOG.exists():
        print(f"[!] Sent log {SENT_LOG} not found.")
        return

    with open(SENT_LOG, mode="r", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))

    print(f"[*] Found {len(rows)} records in sent log. Starting concurrent sync...")

    synced_count = 0
    failed_count = 0

    with ThreadPoolExecutor(max_workers=4) as executor:
        future_to_row = {executor.submit(sync_single_customer, r): r for r in rows}
        for future in as_completed(future_to_row):
            r = future_to_row[future]
            code, success, note = future.result()
            if success:
                synced_count += 1
                print(f"[✓] Synced {code} ({r.get('Phone Number')}) -> Chatwoot")
            else:
                failed_count += 1
                print(f"[!] Failed {code} ({r.get('Phone Number')}): {note}")

    print("=" * 80)
    print(f"🏁 CHATWOOT SYNC FINISHED: {synced_count} Synced, {failed_count} Failed.")
    print("=" * 80)


if __name__ == "__main__":
    main()
