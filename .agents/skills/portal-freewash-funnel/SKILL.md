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

## 6. Day 5 Reminder & Exit Cadence (Rule 10)

Under **Rule 10 (`rush-funnel-rules`)**:
1. **Day 0**: Customer receives `firstwash` voucher.
2. **If Redeemed ($\ge 1$ wash)**: Advances to Post-Wash Conversion Cadence (Stage 3).
3. **If Unredeemed on Day 5**: Receives exactly **one reminder** (`freewash_redemption_reminder`):
   > *"يا هلا! ⏰🚗 باقي 48 ساعة بس على كود FIRSTWASH! مر رش واش وعط موترك لمعة وحماية النانو + تنظيف داخلي مجاناً. ✨"*
4. **If Still Unredeemed after Expiry**: **STRICT EXIT**. Zero automated sequences, promotions, or discounts are ever sent to unredeemed leads.

---

## 7. Operational Commands

| Action | Command |
| :--- | :--- |
| **Inspect Cohort (Dry-Run)** | `python -X utf8 scripts/run_daily_freewash_funnel.py` |
| **Inspect Exported CSV** | Check `exports/dry_run_freewash_today_100.csv` |
| **Check Sent Log** | Check `exports/portal_freewash_sent_log.csv` |
| **Live Dispatch (After Sign-off)** | `python -X utf8 scripts/run_daily_freewash_funnel.py --dispatch --confirm` |
