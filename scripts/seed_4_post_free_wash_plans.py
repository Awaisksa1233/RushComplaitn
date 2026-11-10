"""
Seed 4 Post-Free-Wash Plans into Local and VPS rush_funnel.funnel_flows
=======================================================================
"""

import sys
import json
from pathlib import Path
from pymongo import MongoClient

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import paramiko
from unifonic_app.config import VPS_HOST, SSH_PORT, SSH_USER, SSH_PASS

FLOW_13_PATCH = {
    "name": {
        "en": "Membership: 4 Offers after Free Wash",
        "ar": "العضوية: 4 عروض بعد الغسلة المجانية"
    },
    "description": {
        "en": "After the free wash is used, sends one of four plans (4-way split): 1. 100 SAR membership, 2. 50 SAR wallet balance, 3. Free interior on next visit, 4. Free interior for whole month with membership. Stops once they subscribe.",
        "ar": "بعد استخدام الغسلة المجانية يرسل أحد أربعة خطط (تقسيم رباعي): 1. عضوية بـ 100 ريال، 2. إضافة 50 ريال رصيد محفظة، 3. غسيل داخلي مجاني بالزيارة القادمة، 4. تنظيف داخلي مجاني لمدة شهر كامل مع العضوية. يتوقف عند الاشتراك."
    },
    "trigger": {
        "type": "event",
        "stageId": "free_wash_redeemed",
        "maxAgeHours": 72
    },
    "exitWhen": [
        {"type": "stage_reached", "stageId": "subscribed"},
        {"type": "has_entitled_subscription"}
    ],
    "reentry": "once",
    "volume": {"perHour": 50, "perDay": 300},
    "window": {"days": [0, 1, 2, 3, 4, 6], "startHour": 10, "endHour": 20},
    "status": "paused",
    "approveFirstBatch": True,
    "hasDraft": False,
    "steps": [
        {
            "id": "m3",
            "kind": "send_template",
            "name": {
                "en": "Offers (4 Plans)",
                "ar": "العروض (4 خطط)"
            },
            "templateId": "100_sar_a",
            "variants": [
                {"key": "A", "templateId": "100_sar_a", "weight": 25},
                {"key": "B", "templateId": "50_sar_a", "weight": 25},
                {"key": "C", "templateId": "free_interior", "weight": 25},
                {"key": "D", "templateId": "free_interior_membership", "weight": 25}
            ],
            "paused": False
        }
    ]
}

FLOW_REMINDER_D = {
    "_id": "mf-reminder-d",
    "name": {
        "en": "Membership: Offer D reminder",
        "ar": "العضوية: تذكير العرض د"
    },
    "description": {
        "en": "48 hours after Offer D (free interior for whole month with membership) was sent, reminds the customer if they have not subscribed.",
        "ar": "بعد 48 ساعة من إرسال العرض د (شهر داخلي مجاني مع العضوية)، تذكير العميل إذا لم يشترك."
    },
    "trigger": {
        "type": "offer_sent",
        "templateIds": ["free_interior_membership"],
        "fromFlowId": "mf-offers",
        "maxAgeHours": 72
    },
    "exitWhen": [
        {"type": "stage_reached", "stageId": "subscribed"},
        {"type": "has_entitled_subscription"}
    ],
    "reentry": "once",
    "volume": {"perHour": 50, "perDay": 300},
    "window": {"days": [0, 1, 2, 3, 4, 6], "startHour": 10, "endHour": 20},
    "status": "paused",
    "approveFirstBatch": True,
    "hasDraft": False,
    "steps": [
        {
            "id": "m5dw",
            "kind": "wait",
            "name": {"en": "Wait 2 days", "ar": "انتظار يومين"},
            "waitHours": 48,
            "paused": False
        },
        {
            "id": "m5d",
            "kind": "send_template",
            "name": {"en": "Offer D reminder", "ar": "تذكير العرض د"},
            "templateId": "free_interior_subscription_reminder",
            "reminder": True,
            "deadline": {"afterHours": 48, "onExpire": "exit"},
            "variants": [
                {"key": "A", "templateId": "free_interior_subscription_reminder", "weight": 50},
                {"key": "B", "templateId": "free_interior_subscription_reminder", "weight": 50}
            ],
            "paused": False
        }
    ]
}

def update_mongo(client, db_name="rush_funnel"):
    db = client[db_name]
    coll = db["funnel_flows"]
    
    # 1. Update mf-offers (preserve existing number)
    coll.update_one(
        {"_id": "mf-offers"},
        {"$set": FLOW_13_PATCH},
        upsert=True
    )
    print(f"  [Mongo] Updated mf-offers with 4 plans in {db_name}")

    # 2. Check if mf-reminder-d already exists
    existing_d = coll.find_one({"_id": "mf-reminder-d"})
    if not existing_d:
        rem_c = coll.find_one({"_id": "mf-reminder-c"})
        c_num = rem_c.get("number", 15) if rem_c else 15
        d_num = c_num + 1
        
        # Shift subsequent flows descending
        subsequent = list(coll.find({"number": {"$gte": d_num}}).sort("number", -1))
        for flow in subsequent:
            coll.update_one({"_id": flow["_id"]}, {"$set": {"number": flow["number"] + 1}})
        
        FLOW_REMINDER_D["number"] = d_num
    else:
        FLOW_REMINDER_D["number"] = existing_d["number"]
    
    # Insert or update mf-reminder-d
    coll.update_one(
        {"_id": "mf-reminder-d"},
        {"$set": FLOW_REMINDER_D},
        upsert=True
    )
    print(f"  [Mongo] Inserted/updated mf-reminder-d (number {FLOW_REMINDER_D['number']}) in {db_name}")

def main():
    print("[1/2] Updating Local MongoDB (mongodb://127.0.0.1:27017/rush_funnel)...")
    local_mc = MongoClient("mongodb://127.0.0.1:27017", serverSelectionTimeoutMS=2000)
    update_mongo(local_mc, "rush_funnel")
    print("      Local rush_funnel updated.")

    print("\n[2/2] Updating VPS MongoDB on port 27018 via SSH...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(VPS_HOST, port=SSH_PORT, username=SSH_USER, password=SSH_PASS, timeout=20)
    
    doc_13_str = json.dumps(FLOW_13_PATCH, ensure_ascii=False)
    doc_remd_str = json.dumps(FLOW_REMINDER_D, ensure_ascii=False)
    
    node_script = f"""const {{ MongoClient }} = require('/opt/rush-funnel-node/node_modules/mongodb');
(async () => {{
  const client = new MongoClient('mongodb://127.0.0.1:27018');
  await client.connect();
  const db = client.db('rush_funnel');
  const coll = db.collection('funnel_flows');
  
  // 1. Update mf-offers
  await coll.updateOne({{ _id: 'mf-offers' }}, {{ $set: {doc_13_str} }}, {{ upsert: true }});
  
  // 2. Check mf-reminder-d
  const existingD = await coll.findOne({{ _id: 'mf-reminder-d' }});
  let dNum = 17;
  if (!existingD) {{
    const remC = await coll.findOne({{ _id: 'mf-reminder-c' }});
    const cNum = remC && remC.number ? remC.number : 16;
    dNum = cNum + 1;
    
    // Shift subsequent descending
    const subsequent = await coll.find({{ number: {{ $gte: dNum }} }}).sort({{ number: -1 }}).toArray();
    for (const f of subsequent) {{
      await coll.updateOne({{ _id: f._id }}, {{ $set: {{ number: f.number + 1 }} }});
    }}
  }} else {{
    dNum = existingD.number;
  }}
  
  const dPatch = {doc_remd_str};
  dPatch.number = dNum;
  await coll.updateOne({{ _id: 'mf-reminder-d' }}, {{ $set: dPatch }}, {{ upsert: true }});
  
  console.log(`VPS rush_funnel funnel_flows updated! mf-reminder-d assigned number ${{dNum}}`);
  await client.close();
}})();
"""
    sftp = ssh.open_sftp()
    with sftp.file('/tmp/seed_4_plans.js', 'w') as f:
        f.write(node_script)
    sftp.close()

    stdin, stdout, stderr = ssh.exec_command("node /tmp/seed_4_plans.js")
    out = stdout.read().decode('utf-8', errors='ignore').strip()
    err = stderr.read().decode('utf-8', errors='ignore').strip()
    if out:
        print(f"      {out}")
    if err:
        print(f"      [STDERR] {err}")
    ssh.exec_command("rm -f /tmp/seed_4_plans.js")
    ssh.close()
    print("      VPS rush_funnel updated.")

if __name__ == '__main__':
    main()
