---
name: portal-freewash-funnel
description: >-
  Strict acquisition funnel workflow for Portal Signups with 0 washes (September 2026 onwards).
  Evaluates daily 100-customer batches (up to 50 New <24h dynamically balanced with Old backlog
  chronologically from Sep 1), enforces zero-duplication tracking, uses the approved `firstwash`
  template, and STRICTLY MANDATES explicit user confirmation before any live dispatch ("Ask Before").
---

# Portal Signups Free-Wash Funnel (`firstwash`)

## 1. Overview & Core Philosophy

At **رش واش** (`Rush Wash`), new user acquisition starts strictly with a **Free Wash** voucher (`FIRSTWASH`).
This skill manages the top-of-funnel messaging for online portal signups who registered but have not yet washed their car.

### Key Policies
1. **Audience Scope**: Portal signups (`createdById: 'portal-signup'`) registered on or after **September 1, 2026 (AST)**.
2. **Zero-Wash Gate**: Customer has **0 recorded washes** in `rushwash_wash_histories` (verified across both `customerId` and all linked vehicle license plates in `rushwash_vehicles`).
3. **No Active Subscription**: Customer does not have an active or past contract in `rushwash_subscriptions`.
4. **Daily Volume Cap**: Exactly **100 customers per batch** (balanced as 50 New + 50 Old, dynamically backfilling Old if New < 50).
5. **Chronological Backlog (Option A)**: Old backlog customers are sorted chronologically from September 1, 2026 onwards (`createdAt` ASC).
6. **Brand Name**: Official Arabic brand name is strictly **`رش واش`** (never 'روش').
7. **Timezone**: All evaluation windows, dates, and logs are in Riyadh Time (**AST / `Asia/Riyadh` / UTC+3**).

---

## 2. Mandatory "Ask Before Dispatch" Gate (STRICT)

> [!IMPORTANT]
> **NEVER AUTO-DISPATCH OR SELF-APPROVE**:
> - The agent must **NEVER** trigger live WhatsApp message dispatch without presenting the cohort and receiving explicit user sign-off ("Ask Before").
> - Any evaluation must run in `--dry-run` mode first.
> - The agent must display the cohort composition, sample preview with customer codes, phone numbers, and vehicle license plates (`displayPlate`), and wait for explicit confirmation (e.g., "Dispatch", "Approved", "Go ahead").

### Execution Workflow

```
1. Run Dry-Run Script
   python -X utf8 scripts/run_daily_freewash_funnel.py
                  │
                  ▼
2. Review Cohort & Export CSV
   - Verify 100 recipients (New vs Old counts)
   - Inspect vehicle license plates and phone numbers
   - File: `exports/dry_run_freewash_today_100.csv`
                  │
                  ▼
3. STOP TURN & ASK USER ("Ask Before")
   - Present summary to the user
   - Wait for explicit user confirmation
                  │
                  ▼ (User confirms "Dispatch")
4. Live Dispatch Execution
   python -X utf8 scripts/run_daily_freewash_funnel.py --dispatch --confirm
                  │
                  ▼
5. Real-Time Logging & Delivery Report
   - Persistent append to `exports/portal_freewash_sent_log.csv`
   - Report sent vs failed counts to the user
```

---

## 3. Approved WhatsApp Template Details

- **Template Name**: `firstwash`
- **Category**: `MARKETING` | **Language**: `ar`
- **Variables**: None (static text)
- **Promo Code**: `FIRSTWASH` (valid for 7 days at sales bay for Nano Wash + Interior Cleaning)

### Approved Template Text:
```
حياك الله في رش! غسلتك الأولى علينا. استخدم الرمز FIRSTWASH عند مسار المبيعات خلال ٧ أيام واستمتع بغسلة نانو + تنظيف داخلي مجاناً.
```

---

## 4. Cohort Selection & Dynamic Balancing Logic

Each batch consists of up to **100 unique customers**:

```python
# 1. New Segment: Registered in the last 24 hours
new_candidates = [c for c in eligible if c.createdAtAST >= (now_ast - timedelta(hours=24))]

# 2. Old Segment: Registered between Sep 1, 2026 and 24h ago, sorted oldest first
old_candidates = [c for c in eligible if c.createdAtAST < (now_ast - timedelta(hours=24))]
old_candidates.sort(key=lambda c: c.createdAtAST)  # Chronological (Sep 1+)

# 3. Dynamic Backfill
selected_new = new_candidates[:50]
needed_old = 100 - len(selected_new)
selected_old = old_candidates[:needed_old]

batch = selected_new + selected_old  # Exactly 100
```

---

## 5. Deduplication & Persistent Logging

- **Log File**: `exports/portal_freewash_sent_log.csv`
- Every customer successfully messaged is logged with:
  `Customer Code`, `Phone Number`, `Customer Name`, `Plate`, `Segment`, `Sent At AST`, `Message ID`, `Status`.
- Subsequent runs load all previously sent customer codes and E.164 phone numbers and strictly exclude them, guaranteeing **zero duplicate messages**.

---

## 6. Atlas POS Snapshot Synchronization (`CMP-00033` & `DSC-00666`)

To ensure customers can redeem their free wash at the branch POS:
1. Dispatched customer codes must be synchronized into the active campaign snapshot on **MongoDB Atlas**:
   - Campaign: `CMP-00033` (`rushwash_crm_campaigns`)
   - Coupon: `DSC-00666` (`rushwash_discounts`)
2. **Rolling 7-Day Active Snapshot Policy (CRITICAL)**:
   - The campaign snapshot array in Atlas (`audienceSnapshotCustomerCodes`) must maintain a **rolling union of all active customer codes dispatched within their 7-day window**.
   - When adding a new daily batch (e.g. today's 100), **NEVER overwrite or drop previous batches** that are still within their 7-day validity window (e.g. yesterday's 100 + today's 100 = 200 active codes).
   - Customers remain in the active snapshot until their 7th day expires unredeemed or they redeem their wash.
3. Validity window is set to span the full active window (from the earliest active batch date `00:00:00 AST` to `23:59:59 AST` on Day 7 of the latest batch).
4. Script: `python -X utf8 scripts/update_cmp00033_snapshot.py both`

---

## 7. Mandatory Chatwoot Synchronization (CRITICAL)

All outbound WhatsApp messages sent to customers must be immediately synchronized into **Chatwoot**:
- **Why**: Customer support agents in Chatwoot must see the full campaign history and the exact message text received by the customer.
- **Payload Attributes**:
  - `to_phone`: Customer's E.164 phone number
  - `content`: Exact `firstwash` Arabic text
  - `customer_name`: Customer name formatted with vehicle license plate, e.g. `Valued Customer (8289AAB)`
  - `campaign_name`: `portal_freewash_firstwash`
  - `message_id`: Unifonic outbound message ID
- **Execution**: Run `python -X utf8 scripts/sync_freewash_sent_to_chatwoot.py` immediately following dispatch.

---

## 8. Lifecycle Tracking & Day 7 Atlas Removal (Rule 10)

Under **Rule 10 (`rush-funnel-rules`)**:
1. **Day 0 (Welcome)**: Customer receives `firstwash` voucher and is added to the tracking ledger.
2. **If Redeemed ($\ge 1$ wash)**: Customer is marked as `REDEEMED` in `portal_freewash_tracking_ledger.csv` and advances to Post-Wash Conversion (Stage 3).
3. **If Unredeemed on Day 5**: Receives exactly **one reminder** (`freewash_redemption_reminder`):
   > *"يا هلا! ⏰🚗 باقي 48 ساعة بس على كود FIRSTWASH! مر رش واش وعط موترك لمعة وحماية النانو + تنظيف داخلي مجاناً. ✨"*
4. **If Unredeemed on Day 7 (Strict Expiry & Removal)**:
   - **Atlas Snapshot Removal**: Customer code is pulled from `audienceSnapshotCustomerCodes` in `CMP-00033` on MongoDB Atlas, deactivating the voucher at the POS.
   - **Funnel Exit**: Status marked as `EXPIRED_REMOVED`. The customer strictly exits the funnel with zero future promotions or discounts.
   - **Command**: `python -X utf8 scripts/track_and_expire_freewash_funnel.py --apply-removals`

---

## 9. Funnel Database (`rush_funnel`) Synchronization (CRITICAL)

To ensure the Membership Funnel dashboard (`https://whatsapp.rush.com.sa/funnel`) displays accurate metrics:
1. Every dispatch and redemption event must be synced to the dedicated funnel database `rush_funnel`:
   - **Local DB**: `mongodb://127.0.0.1:27017/rush_funnel`
   - **VPS DB**: `mongodb://127.0.0.1:27018/rush_funnel`
2. **Collections Updated**:
   - `funnel_messages`: Logs every sent message with `templateId: 'firstwash'`, `flowId: 'mf-signup-coupon'`, `status: 'sent'`.
   - `funnel_contacts`: Stores contacts, plates, customer code, and stages reached.
   - `funnel_events`: Stores `signed_up` entry events and `free_wash_redeemed` events for customers who washed.
3. **Execution Script**:
   ```powershell
   python -X utf8 scripts/sync_freewash_funnel_to_funnel_db.py
   python -X utf8 scripts/deploy_and_sync_vps_funnel.py
   ```

---

## 10. Operational Commands Quick Reference

| Action | Command |
| :--- | :--- |
| **Inspect Cohort (Dry-Run)** | `python -X utf8 scripts/run_daily_freewash_funnel.py` |
| **Update Atlas POS Snapshot** | `python -X utf8 scripts/update_cmp00033_snapshot.py both` |
| **Live Dispatch (After Sign-off)** | `python -X utf8 scripts/run_daily_freewash_funnel.py --dispatch --confirm` |
| **Sync to Chatwoot** | `python -X utf8 scripts/sync_freewash_sent_to_chatwoot.py` |
| **Sync to Funnel DB (Local & VPS)** | `python -X utf8 scripts/deploy_and_sync_vps_funnel.py` |
| **Audit Redemptions & Expirations** | `python -X utf8 scripts/track_and_expire_freewash_funnel.py` |
| **Execute Day 7 Removals from Atlas** | `python -X utf8 scripts/track_and_expire_freewash_funnel.py --apply-removals` |
| **Inspect Tracking Ledger** | Check `exports/portal_freewash_tracking_ledger.csv` |

