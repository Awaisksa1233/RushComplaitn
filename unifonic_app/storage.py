import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from pymongo import MongoClient, DESCENDING, ASCENDING
from unifonic_app.config import MONGODB_URI, DB_NAME, COLLECTION_NAME, JSONL_LOG_PATH, PROJECT_DIR, APP_DIR, STORAGE_BACKEND
from unifonic_app import db as _db
from unifonic_app.models import NormalizedWhatsAppEvent, extract_phone_number

logger = logging.getLogger("unifonic_app.storage")

def get_event_customer_timestamp(ev: Dict[str, Any]) -> str:
    """
    Extracts the true customer message timestamp, prioritizing customer send / gateway receive time
    over webhook reception / DB insert time.
    """
    if not isinstance(ev, dict):
        return ""
    
    raw = ev.get("raw_payload") if isinstance(ev.get("raw_payload"), dict) else {}
    candidates = [
        raw.get("timestamp"),
        raw.get("receivedAt"),
        raw.get("sentAt"),
        raw.get("sent_at"),
        raw.get("createdAt"),
        raw.get("created_at"),
        raw.get("time"),
        raw.get("Date"),
        (raw.get("message") or {}).get("timestamp") if isinstance(raw.get("message"), dict) else None,
        (raw.get("content") or {}).get("timestamp") if isinstance(raw.get("content"), dict) else None,
        ev.get("sent_at"),
        ev.get("received_at"),
        ev.get("saved_at")
    ]
    for c in candidates:
        if c and str(c).strip():
            ts_str = str(c).strip()
            if ts_str.isdigit():
                try:
                    val = int(ts_str)
                    if val > 1e11:
                        return datetime.fromtimestamp(val / 1000, tz=timezone.utc).isoformat()
                    else:
                        return datetime.fromtimestamp(val, tz=timezone.utc).isoformat()
                except Exception:
                    pass
            if " " in ts_str and "T" not in ts_str:
                ts_str = ts_str.replace(" ", "T")
                if not ts_str.endswith("Z") and "+" not in ts_str:
                    ts_str += "Z"
            return ts_str
    return ""

class StorageManager:
    def __init__(self):
        self.mongo_client: Optional[MongoClient] = None
        self.db = None
        self.collection = None
        self._cached_events: List[Dict[str, Any]] = []
        self._last_mtime: float = 0.0
        self._cache_rev: Optional[int] = None
        self.campaign_message_ids: Dict[str, Dict[str, Any]] = {}
        self._last_registry_load_ts: float = 0.0
        self._init_mongo()
        self._load_campaign_registries()
        if self._sqlite:
            self._import_legacy_if_empty()

    def _ensure_campaign_registries_fresh(self):
        import time
        now = time.time()
        if now - self._last_registry_load_ts > 15.0:
            self._load_campaign_registries()

    @property
    def _sqlite(self) -> bool:
        return STORAGE_BACKEND == "sqlite"

    @staticmethod
    def _phone_key(doc: Dict[str, Any]) -> Optional[str]:
        return extract_phone_number(doc.get("customer_phone") or doc.get("sender") or doc.get("recipient"))

    def _import_legacy_if_empty(self):
        """Safety net: a brand-new database is seeded (read-only) from the existing JSONL file, once.

        The JSONL files are only read, never modified. scripts/migrate_jsonl_to_sqlite.py does the
        same with a dry-run and backups; this just guarantees history is never hidden by an empty DB.
        """
        if os.getenv("UNIFONIC_SKIP_AUTOSEED") == "1":
            return
        try:
            has_rows = _db.get_conn().execute("SELECT 1 FROM events LIMIT 1").fetchone()
            if has_rows or _db.get_meta("imported:events"):
                return
            res = _db.import_jsonl("events", JSONL_LOG_PATH, ts_fn=get_event_customer_timestamp, phone_fn=self._phone_key)
            if res["imported"]:
                logger.warning(f"Seeded SQLite from {JSONL_LOG_PATH.name}: {res['imported']} events ({res['malformed']} malformed skipped)")
        except Exception as e:
            logger.error(f"Legacy JSONL import failed: {e}")

    def _load_campaign_registries(self):
        """Loads campaign message IDs from state files and all dispatch logs."""
        import csv
        import time
        self._last_registry_load_ts = time.time()
        self.campaign_message_ids = {}

        # 1. State files (e.g. Watan96)
        possible_state_paths = [
            PROJECT_DIR / "campaign_watan96_state.json",
            APP_DIR / "campaign_watan96_state.json",
            Path("/opt/unifonic_app/unifonic_app/campaign_watan96_state.json"),
            Path("/opt/unifonic_app/campaign_watan96_state.json")
        ]
        for p in possible_state_paths:
            if p.exists():
                try:
                    with open(p, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    sent = data.get("sent", {})
                    for phone, item in sent.items():
                        mid = item.get("message_id")
                        if mid and str(mid).strip() and str(mid).strip().lower() != "none":
                            clean_mid = str(mid).strip()
                            self.campaign_message_ids[clean_mid] = {
                                "phone": phone,
                                "name": item.get("name"),
                                "cus": item.get("cus"),
                                "plate": item.get("plate"),
                                "sent_at": item.get("sent_at"),
                                "campaign_name": "Watan96 (96_sar)"
                            }
                    logger.info(f"Loaded {len(self.campaign_message_ids)} campaign IDs from state file {p.name}")
                    break
                except Exception as e:
                    logger.warning(f"Error loading campaign state from {p}: {e}")

        # 2. Dispatch logs (CSVs across VPS and local workspace)
        search_dirs = [
            Path("/opt/unifonic_app/campaigns"),
            Path("/opt/unifonic_app"),
            PROJECT_DIR,
            APP_DIR
        ]
        loaded_files = set()
        for sdir in search_dirs:
            if not sdir.exists():
                continue
            for csv_path in sdir.glob("*dispatch_log*.csv"):
                if csv_path.name in loaded_files:
                    continue
                loaded_files.add(csv_path.name)
                try:
                    with open(csv_path, mode="r", encoding="utf-8-sig") as f:
                        reader = csv.DictReader(f)
                        c_name = csv_path.stem.replace("_dispatch_log", "").replace("_", " ").title()
                        for r in reader:
                            mid = r.get("WhatsApp Message ID") or r.get("message_id") or r.get("Message ID") or r.get("msg_id")
                            if mid and str(mid).strip() and str(mid).strip().lower() != "none":
                                clean_mid = str(mid).strip()
                                if clean_mid not in self.campaign_message_ids:
                                    phone = r.get("Phone Number") or r.get("phone") or r.get("mobile") or r.get("contact")
                                    self.campaign_message_ids[clean_mid] = {
                                        "phone": str(phone).strip() if phone else None,
                                        "sent_at": r.get("Timestamp") or r.get("timestamp") or r.get("sent_at"),
                                        "name": r.get("Customer Name") or r.get("customer_name") or r.get("name"),
                                        "cus": r.get("Customer Code") or r.get("customer_code") or r.get("cus"),
                                        "status": r.get("Status") or r.get("status") or "SENT",
                                        "template_name": r.get("Template") or r.get("template") or r.get("template_name"),
                                        "campaign_name": c_name
                                    }
                except Exception as ce:
                    logger.debug(f"Error loading dispatch log {csv_path}: {ce}")

        logger.info(f"Total campaign message IDs registered in storage: {len(self.campaign_message_ids)}")

    def _init_mongo(self):
        # User requested: Do not use Atlas. High-performance local JSONL & memory index used.
        if not MONGODB_URI:
            logger.info("Local file storage active (Atlas disabled).")
            self.mongo_client = None
            self.db = None
            self.collection = None
            return

        try:
            self.mongo_client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=2000)
            self.mongo_client.admin.command('ping')
            self.db = self.mongo_client[DB_NAME]
            self.collection = self.db[COLLECTION_NAME]
            logger.info("MongoDB connected successfully.")
        except Exception as e:
            logger.info(f"MongoDB not available: {e}. Using local JSONL storage.")
            self.mongo_client = None
            self.db = None
            self.collection = None

    def _persist_event(self, doc: Dict[str, Any]):
        """Durably store one event doc: SQLite row (+ append-only JSONL mirror), or legacy JSONL only."""
        if self._sqlite:
            try:
                _db.insert_event(doc, event_ts=get_event_customer_timestamp(doc), phone_key=self._phone_key(doc))
            except Exception as e:
                logger.error(f"Failed to insert event into SQLite: {e}")
            _db.mirror_jsonl(JSONL_LOG_PATH, doc)
            return
        try:
            with open(JSONL_LOG_PATH, "a", encoding="utf-8") as f:
                f.write(json.dumps(doc, ensure_ascii=False) + "\n")
            if self._cached_events is not None:
                self._cached_events.append(doc)
                try:
                    self._last_mtime = JSONL_LOG_PATH.stat().st_mtime
                except Exception:
                    pass
        except Exception as e:
            logger.error(f"Failed to append to JSONL log: {e}")

    def _append_jsonl(self, doc: Dict[str, Any]):
        self._persist_event(doc)

    def is_mongo_connected(self) -> bool:
        if not self.mongo_client or self.collection is None:
            return False
        try:
            self.mongo_client.admin.command('ping')
            return True
        except Exception:
            return False

    def save_event(self, event: NormalizedWhatsAppEvent) -> Dict[str, Any]:
        doc = event.model_dump()
        doc["saved_at"] = datetime.now(timezone.utc).isoformat()
        
        # Ensure clean customer_phone
        if event.event_type == "inbound_message":
            doc["customer_phone"] = extract_phone_number(event.sender)
            doc["direction"] = "inbound"
        elif event.event_type == "outbound_message":
            doc["customer_phone"] = extract_phone_number(event.recipient)
            doc["direction"] = "outbound"
        elif event.event_type == "delivery_status":
            doc["customer_phone"] = extract_phone_number(event.recipient or event.customer_phone)
            doc["direction"] = "status_update"
            if event.message_id and event.status:
                self.update_message_status(
                    event.message_id, 
                    event.status, 
                    event.error,
                    pricing_category=event.pricing_category,
                    pricing_type=event.pricing_type,
                    billable=event.billable,
                    pricing_model=event.pricing_model
                )
        else:
            doc["customer_phone"] = extract_phone_number(event.sender or event.recipient)
            doc["direction"] = "unknown"

        # 1. Persist locally (SQLite + JSONL mirror)
        self._persist_event(doc)

        # 2. Persist to MongoDB if available (upsert by unique message_id)
        mongo_id = None
        if self.collection is not None:
            try:
                if event.message_id:
                    res = self.collection.update_one(
                        {"message_id": event.message_id},
                        {"$set": doc},
                        upsert=True
                    )
                    mongo_id = str(res.upserted_id or event.message_id)
                else:
                    res = self.collection.insert_one(doc)
                    mongo_id = str(res.inserted_id)
            except Exception as e:
                logger.error(f"Failed to insert/upsert into MongoDB: {e}")

        return {
            "saved": True,
            "mongo_id": mongo_id,
            "jsonl": str(JSONL_LOG_PATH),
            "event_type": event.event_type,
            "customer_phone": doc.get("customer_phone")
        }

    def save_outbound_message(self, phone: str, text: Optional[str] = None, message_id: Optional[str] = None, status: str = "SENT", error: Optional[str] = None, media_url: Optional[str] = None) -> Dict[str, Any]:
        clean_phone = extract_phone_number(phone)
        now_iso = datetime.now(timezone.utc).isoformat()
        mid = message_id or f"msg_out_{int(datetime.now(timezone.utc).timestamp()*1000)}"
        attachments = [{"url": media_url, "data_url": media_url, "type": "image"}] if media_url else []
        doc = {
            "id": f"out_{int(datetime.now(timezone.utc).timestamp()*1000)}",
            "event_type": "outbound_message",
            "direction": "outbound",
            "sender": "RushWash",
            "recipient": clean_phone,
            "customer_phone": clean_phone,
            "message_id": mid,
            "status": status.upper(),
            "content": text or (f"[Media Attachment: {media_url}]" if media_url else ""),
            "attachments": attachments,
            "media_url": media_url,
            "error": error,
            "channel": "whatsapp",
            "sent_at": now_iso,
            "delivered_at": None,
            "read_at": None,
            "received_at": now_iso,
            "saved_at": now_iso,
            "raw_payload": {
                "text": text,
                "media_url": media_url,
                "recipient": clean_phone,
                "status": status,
                "error": error
            }
        }

        # 1. Persist locally (SQLite + JSONL mirror)
        self._persist_event(doc)

        # 2. Write to MongoDB
        if self.collection is not None:
            try:
                self.collection.insert_one(doc)
            except Exception as e:
                logger.error(f"Error saving outbound message to Mongo: {e}")

        return doc

    def update_message_status(
        self, 
        message_id: str, 
        new_status: str, 
        error_desc: Optional[str] = None,
        pricing_category: Optional[str] = None,
        pricing_type: Optional[str] = None,
        billable: Optional[bool] = None,
        pricing_model: Optional[str] = None
    ):
        if not message_id:
            return
        st_upper = new_status.upper()
        now_iso = datetime.now(timezone.utc).isoformat()
        update_fields: Dict[str, Any] = {
            "status": st_upper,
            "status_updated_at": now_iso
        }
        if "DELIV" in st_upper:
            update_fields["delivered_at"] = now_iso
        elif "READ" in st_upper:
            update_fields["read_at"] = now_iso
        elif "FAIL" in st_upper or "REJECT" in st_upper or "UNDELIV" in st_upper:
            update_fields["error"] = error_desc or "Delivery failed"

        if pricing_category is not None:
            update_fields["pricing_category"] = pricing_category
        if pricing_type is not None:
            update_fields["pricing_type"] = pricing_type
        if billable is not None:
            update_fields["billable"] = billable
        if pricing_model is not None:
            update_fields["pricing_model"] = pricing_model

        if self._sqlite:
            try:
                _db.update_events_by_message_id(message_id, update_fields)
            except Exception as e:
                logger.error(f"Failed to update status in SQLite: {e}")
        elif self._cached_events:
            for ev in self._cached_events:
                if ev.get("message_id") == message_id:
                    ev.update(update_fields)

        if self.collection is not None:
            try:
                self.collection.update_many(
                    {"message_id": message_id},
                    {"$set": update_fields}
                )
            except Exception as e:
                logger.warning(f"Failed to update status in Mongo: {e}")

    def _read_all_jsonl(self) -> List[Dict[str, Any]]:
        if self._sqlite:
            # Cached materialised list, invalidated by the shared write revision (safe across gunicorn workers)
            try:
                rev = _db.get_rev()
                if self._cached_events and self._cache_rev == rev:
                    return self._cached_events
                self._cached_events = _db.load_events()
                self._cache_rev = rev
                return self._cached_events
            except Exception as e:
                logger.error(f"Error reading events from SQLite: {e}")
                return self._cached_events or []
        if not JSONL_LOG_PATH.exists():
            return []
        try:
            mtime = JSONL_LOG_PATH.stat().st_mtime
            if self._cached_events and mtime == self._last_mtime:
                return self._cached_events
            events = []
            with open(JSONL_LOG_PATH, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line:
                        try:
                            events.append(json.loads(line))
                        except Exception:
                            pass
            self._cached_events = events
            self._last_mtime = mtime
            return self._cached_events
        except Exception as e:
            logger.error(f"Error reading JSONL: {e}")
            return self._cached_events or []

    def get_conversations(self) -> List[Dict[str, Any]]:
        """
        Returns active chats. ONLY genuine conversations (inbound or outbound with text content).
        Sorted strictly by customer message timestamp (latest customer/agent message first).
        """
        all_events = self._read_all_jsonl()
        if not all_events and self.collection is not None:
            try:
                cursor = self.collection.find(
                    {
                        "event_type": {"$in": ["inbound_message", "outbound_message"]},
                        "content": {"$nin": [None, ""]}
                    },
                    {"_id": 0}
                )
                all_events = list(cursor)
            except Exception:
                pass

        # Group all genuine messages by clean customer phone
        phone_groups: Dict[str, List[Dict[str, Any]]] = {}
        for ev in all_events:
            content = ev.get("content")
            if not content or not str(content).strip():
                continue

            ev_type = ev.get("event_type")
            if ev_type not in ["inbound_message", "outbound_message"]:
                continue

            raw_phone = ev.get("customer_phone") or ev.get("sender") or ev.get("recipient")
            phone = extract_phone_number(raw_phone)
            if not phone or phone.lower() in ["rushwash", "rush"]:
                continue

            if phone not in phone_groups:
                phone_groups[phone] = []
            phone_groups[phone].append(ev)

        conv_list = []
        for phone, msgs in phone_groups.items():
            # Sort all messages of this contact chronologically by customer timestamp
            msgs.sort(key=lambda m: get_event_customer_timestamp(m) or "")
            if not msgs:
                continue

            latest_msg = msgs[-1]
            last_content = str(latest_msg.get("content") or "").strip()
            latest_type = latest_msg.get("event_type")
            last_direction = latest_msg.get("direction") or ("inbound" if latest_type == "inbound_message" else "outbound")
            last_timestamp = get_event_customer_timestamp(latest_msg)
            last_status = latest_msg.get("status")

            # Calculate unread count: count all inbound messages since the last outbound message
            unread_count = 0
            last_outbound_idx = -1
            for idx, m in enumerate(msgs):
                m_dir = m.get("direction") or ("inbound" if m.get("event_type") == "inbound_message" else "outbound")
                if m_dir == "outbound":
                    last_outbound_idx = idx

            # Extract ad attribution from any message in the thread
            ad_source = None
            ad_campaign = None
            ad_keyword = None
            for m in msgs:
                if m.get("ad_source"):
                    ad_source = m.get("ad_source")
                    ad_campaign = m.get("ad_campaign")
                    ad_keyword = m.get("ad_keyword")
                    break

            conv_list.append({
                "phone": phone,
                "last_message": last_content,
                "last_direction": last_direction,
                "last_timestamp": last_timestamp,
                "unread_count": unread_count,
                "message_count": len(msgs),
                "last_status": last_status,
                "ad_source": ad_source,
                "ad_campaign": ad_campaign,
                "ad_keyword": ad_keyword
            })

        # Sort conversation list strictly by newest customer/message timestamp at the top
        conv_list.sort(key=lambda x: x["last_timestamp"] or "", reverse=True)
        return conv_list

    def get_conversation_messages(self, phone: str) -> List[Dict[str, Any]]:
        clean_phone = extract_phone_number(phone)
        messages = []

        if self._sqlite:
            candidates = _db.load_events(
                "phone_key=? AND event_type IN ('inbound_message','outbound_message')", (clean_phone,)
            ) if clean_phone else []
            messages = [ev for ev in candidates if ev.get("content")]
        else:
            for ev in self._read_all_jsonl():
                if not ev.get("content"):
                    continue
                ev_phone = extract_phone_number(ev.get("customer_phone") or ev.get("sender") or ev.get("recipient"))
                if ev_phone == clean_phone and ev.get("event_type") in ["inbound_message", "outbound_message"]:
                    messages.append(ev)

        if not messages and self.collection is not None:
            try:
                query = {
                    "$or": [
                        {"customer_phone": clean_phone},
                        {"sender": clean_phone},
                        {"recipient": clean_phone}
                    ],
                    "event_type": {"$in": ["inbound_message", "outbound_message"]},
                    "content": {"$nin": [None, ""]}
                }
                cursor = self.collection.find(query, {"_id": 0})
                messages = list(cursor)
            except Exception:
                pass

        # Normalize display timestamps to customer message timestamp
        for m in messages:
            cust_ts = get_event_customer_timestamp(m)
            if cust_ts:
                m["received_at"] = cust_ts

        # Sort strictly chronologically by customer timestamp (oldest first to newest at bottom)
        messages.sort(key=lambda x: get_event_customer_timestamp(x) or "")
        return messages

    def get_delivery_reports(
        self,
        status_filter: Optional[str] = None,
        phone_filter: Optional[str] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        cost_per_msg: Optional[float] = None,
        currency: Optional[str] = None,
        traffic_type: str = "campaign",
        limit: int = 200
    ) -> List[Dict[str, Any]]:
        """
        Retrieves WhatsApp delivery reports.
        traffic_type:
          - 'campaign' (default): Only marketing broadcast messages (e.g. Watan96 / 96_sar). Excludes 1-on-1 support chats.
          - 'support': Only 1-on-1 customer support / live chat agent messages.
          - 'all': All outbound delivery reports across the entire channel.
        """
        self._ensure_campaign_registries_fresh()
        all_ev = self._read_all_jsonl()
        if not all_ev and self.collection is not None:
            try:
                cursor = self.collection.find({"event_type": "delivery_status"}, {"_id": 0})
                all_ev = list(cursor)
            except Exception:
                pass
        
        reports_by_id: Dict[str, Dict[str, Any]] = {}

        for ev in all_ev:
            ev_type = ev.get("event_type")
            # Inbound customer messages are not outbound delivery reports
            if ev_type == "inbound_message" or ev.get("direction") == "inbound":
                continue

            mid = ev.get("message_id")
            if not mid:
                continue

            # Determine if this message is part of a marketing campaign
            camp_info = self.campaign_message_ids.get(mid, {})
            is_campaign_msg = (
                bool(camp_info)
                or bool(ev.get("campaign_id"))
                or bool(ev.get("template_name"))
                or bool(ev.get("is_campaign"))
                or ("96_sar" in str(ev.get("content", "")))
                or ("اليوم الوطني" in str(ev.get("content", "")))
                or ("winback" in str(ev.get("content", "")).lower())
                or (not ev.get("chatwoot_conversation_id") and ev.get("direction") == "status_update")
            )

            if traffic_type == "campaign" and not is_campaign_msg:
                continue
            elif traffic_type == "support" and is_campaign_msg:
                continue

            phone = extract_phone_number(ev.get("recipient") or ev.get("customer_phone") or ev.get("raw_payload", {}).get("recipient"))
            raw_st = (ev.get("status") or ev.get("raw_payload", {}).get("eventType") or "SENT").upper()
            
            norm_st = "SENT"
            if "DELIV" in raw_st: norm_st = "DELIVERED"
            elif "READ" in raw_st: norm_st = "READ"
            elif "REJECT" in raw_st or "FAIL" in raw_st or "UNDELIV" in raw_st: norm_st = "FAILED"
            
            timestamp = ev.get("received_at") or ev.get("sent_at")

            # Enrich from campaign metadata if available
            if not phone and camp_info.get("phone"):
                phone = camp_info["phone"]
            content = ev.get("content") or (f"Campaign: {camp_info.get('campaign_name')}" if camp_info else "WhatsApp Notification / Campaign")

            pricing_cat = ev.get("pricing_category") or ev.get("raw_payload", {}).get("pricing", {}).get("category")
            pricing_type = ev.get("pricing_type") or ev.get("raw_payload", {}).get("pricing", {}).get("type")
            billable = ev.get("billable")
            if billable is None:
                billable = ev.get("raw_payload", {}).get("pricing", {}).get("billable")

            if mid not in reports_by_id:
                reports_by_id[mid] = {
                    "message_id": mid,
                    "recipient": phone or "Unknown",
                    "content": content,
                    "status": norm_st,
                    "sent_at": camp_info.get("sent_at") or timestamp,
                    "delivered_at": timestamp if norm_st == "DELIVERED" else None,
                    "read_at": timestamp if norm_st == "READ" else None,
                    "error": ev.get("error") or ev.get("raw_payload", {}).get("failReason"),
                    "is_campaign": is_campaign_msg,
                    "pricing_category": pricing_cat,
                    "pricing_type": pricing_type,
                    "billable": billable
                }
            else:
                rep = reports_by_id[mid]
                if phone and rep["recipient"] == "Unknown":
                    rep["recipient"] = phone
                if ev.get("content"):
                    rep["content"] = ev["content"]
                if pricing_cat:
                    rep["pricing_category"] = pricing_cat
                if pricing_type:
                    rep["pricing_type"] = pricing_type
                if billable is not None:
                    rep["billable"] = billable

                if norm_st == "READ":
                    rep["status"] = "READ"
                    rep["read_at"] = timestamp
                    if not rep["delivered_at"]: rep["delivered_at"] = timestamp
                elif norm_st == "DELIVERED" and rep["status"] != "READ":
                    rep["status"] = "DELIVERED"
                    rep["delivered_at"] = timestamp
                elif norm_st == "FAILED":
                    rep["status"] = "FAILED"
                    rep["error"] = ev.get("error") or ev.get("raw_payload", {}).get("failReason")

        # Ensure all registered campaign messages are included even if DLR webhook hasn't arrived
        if traffic_type in ["campaign", "all"] and self.campaign_message_ids:
            for c_mid, c_info in self.campaign_message_ids.items():
                if c_mid not in reports_by_id:
                    reports_by_id[c_mid] = {
                        "message_id": c_mid,
                        "recipient": c_info.get("phone") or "Unknown",
                        "content": f"Campaign: {c_info.get('campaign_name', 'Broadcast')}",
                        "status": (c_info.get("status") or "SENT").upper(),
                        "sent_at": c_info.get("sent_at"),
                        "delivered_at": None,
                        "read_at": None,
                        "error": None,
                        "is_campaign": True
                    }

        reports = list(reports_by_id.values())
        reports.sort(key=lambda x: x.get("read_at") or x.get("delivered_at") or x.get("sent_at") or "", reverse=True)

        filtered = []
        from unifonic_app.config import DEFAULT_COST_MARKETING, DEFAULT_CURRENCY
        rate = cost_per_msg if cost_per_msg is not None else DEFAULT_COST_MARKETING
        curr = currency or DEFAULT_CURRENCY

        for r in reports:
            if status_filter and status_filter.upper() != "ALL":
                sf = status_filter.upper()
                if sf == "SENT":
                    if r["status"] not in ["SENT", "DELIVERED", "READ"]:
                        continue
                elif sf == "DELIVERED":
                    if r["status"] not in ["DELIVERED", "READ"]:
                        continue
                elif sf == "UNCONFIRMED":
                    if r["status"] != "SENT":
                        continue
                elif r["status"] != sf:
                    continue
            if phone_filter and phone_filter not in str(r.get("recipient", "")):
                continue

            # Date Range Filter
            ts = r.get("sent_at") or r.get("delivered_at") or ""
            if date_from and ts and ts[:10] < date_from:
                continue
            if date_to and ts and ts[:10] > date_to:
                continue

            # Calculate itemized message cost
            st_norm = r.get("status", "SENT").upper()
            if st_norm in ["DELIVERED", "READ"]:
                r["cost"] = round(rate, 3)
            elif st_norm == "SENT":
                r["cost"] = round(rate, 3)
            else:
                r["cost"] = 0.00
            r["currency"] = curr

            filtered.append(r)
            if len(filtered) >= limit:
                break

        return filtered

    def get_delivery_kpis(
        self,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        cost_per_msg: Optional[float] = None,
        currency: Optional[str] = None,
        traffic_type: str = "campaign"
    ) -> Dict[str, Any]:
        from unifonic_app.config import DEFAULT_COST_MARKETING, DEFAULT_CURRENCY
        rate = cost_per_msg if cost_per_msg is not None else DEFAULT_COST_MARKETING
        curr = currency or DEFAULT_CURRENCY

        reports = self.get_delivery_reports(
            date_from=date_from,
            date_to=date_to,
            cost_per_msg=rate,
            currency=curr,
            traffic_type=traffic_type,
            limit=50000
        )
        
        read_count = 0
        delivered_only_count = 0
        failed_count = 0

        for r in reports:
            st = (r.get("status") or "SENT").upper()
            if st == "READ":
                read_count += 1
            elif st == "DELIVERED":
                delivered_only_count += 1
            elif st == "FAILED":
                failed_count += 1

        delivered_total = delivered_only_count + read_count

        # Total Sent calculation
        if traffic_type in ["campaign", "all"] and self.campaign_message_ids:
            if not date_from and not date_to:
                total_sent = max(len(self.campaign_message_ids), len(reports))
            else:
                c_count = 0
                for c_mid, c_info in self.campaign_message_ids.items():
                    ts = c_info.get("sent_at") or ""
                    if date_from and ts and ts[:10] < date_from:
                        continue
                    if date_to and ts and ts[:10] > date_to:
                        continue
                    c_count += 1
                total_sent = max(c_count, len(reports))
        else:
            total_sent = len(reports)

        unconfirmed_count = max(0, total_sent - delivered_total - failed_count)
        
        # Delivery & Read Rates
        delivery_rate = round((delivered_total / total_sent * 100), 1) if total_sent > 0 else 0.0
        read_rate = round((read_count / delivered_total * 100), 1) if delivered_total > 0 else 0.0
        failure_rate = round((failed_count / total_sent * 100), 1) if total_sent > 0 else 0.0
        success_rate = delivery_rate

        # Count received customer messages (inbound) filtered by date range
        all_events = self._read_all_jsonl()
        inbound_count = 0
        for ev in all_events:
            if ev.get("event_type") == "inbound_message" or ev.get("direction") == "inbound":
                ts = get_event_customer_timestamp(ev) or ev.get("received_at") or ""
                if date_from and ts and ts[:10] < date_from:
                    continue
                if date_to and ts and ts[:10] > date_to:
                    continue
                inbound_count += 1
        
        # Total Unifonic spending in specified currency
        total_cost = round(delivered_total * rate, 2)
        
        # Meta / Unifonic Channel Breakdown & Monthly Free Service Messages Quota
        from unifonic_app.config import FREE_SERVICE_MESSAGES_MONTHLY_LIMIT, DEFAULT_COST_SERVICE
        service_rate = current_settings.get("cost_service", DEFAULT_COST_SERVICE) if 'current_settings' in globals() else DEFAULT_COST_SERVICE

        current_month_prefix = datetime.now(timezone.utc).strftime("%Y-%m")
        service_month_delivered = 0
        service_month_billable = 0
        service_month_free = 0

        # Calculate category counts across reports and all_events
        service_delivered_filtered = 0
        utility_count = 0
        marketing_count = 0
        authentication_count = 0

        for r in reports:
            cat = (r.get("pricing_category") or "").lower()
            ptype = (r.get("pricing_type") or "").lower()
            billable = r.get("billable")
            is_deliv = r.get("status") in ["DELIVERED", "READ"]

            if cat == "service":
                if is_deliv:
                    service_delivered_filtered += 1
            elif cat == "utility":
                utility_count += 1
            elif cat == "authentication" or cat == "auth":
                authentication_count += 1
            else:
                marketing_count += 1

        # Check calendar month delivered service messages to track 1,000 free threshold
        for ev in all_events:
            ts = get_event_customer_timestamp(ev) or ev.get("received_at") or ev.get("sent_at") or ""
            if ts and ts.startswith(current_month_prefix):
                ev_cat = (ev.get("pricing_category") or ev.get("raw_payload", {}).get("pricing", {}).get("category") or "").lower()
                st = (ev.get("status") or "").upper()
                if ev_cat == "service" and st in ["DELIVERED", "READ"]:
                    service_month_delivered += 1
                    ptype = (ev.get("pricing_type") or ev.get("raw_payload", {}).get("pricing", {}).get("type") or "").lower()
                    b_flag = ev.get("billable")
                    if b_flag is True or ptype == "regular":
                        service_month_billable += 1
                    else:
                        service_month_free += 1

        # If not explicitly tagged by webhook but exceeds 1,000 threshold
        if service_month_delivered > FREE_SERVICE_MESSAGES_MONTHLY_LIMIT and service_month_billable == 0:
            service_month_free = FREE_SERVICE_MESSAGES_MONTHLY_LIMIT
            service_month_billable = service_month_delivered - FREE_SERVICE_MESSAGES_MONTHLY_LIMIT
        elif service_month_billable == 0:
            service_month_free = min(service_month_delivered, FREE_SERVICE_MESSAGES_MONTHLY_LIMIT)

        service_cost_month = round(service_month_billable * service_rate, 2)
        service_free_remaining = max(0, FREE_SERVICE_MESSAGES_MONTHLY_LIMIT - service_month_delivered)

        service_quota = {
            "monthly_limit": FREE_SERVICE_MESSAGES_MONTHLY_LIMIT,
            "delivered_this_month": service_month_delivered,
            "free_tier_used": min(service_month_delivered, FREE_SERVICE_MESSAGES_MONTHLY_LIMIT),
            "free_tier_remaining": service_free_remaining,
            "billable_service_messages": service_month_billable,
            "service_rate": service_rate,
            "service_cost": service_cost_month,
            "quota_exhausted": service_month_delivered >= FREE_SERVICE_MESSAGES_MONTHLY_LIMIT,
            "effective_date": "2026-10-01",
            "current_month": current_month_prefix
        }

        # Channel breakdown
        service_count = inbound_count
        marketing_lite_count = delivered_total
        bi_spending = total_cost
        ui_spending = 0.0

        return {
            "total": total_sent,
            "submitted": total_sent,
            "sent": total_sent,
            "delivered": delivered_total,
            "read": read_count,
            "unconfirmed": unconfirmed_count,
            "failed": failed_count,
            "success_rate": success_rate,

            # Cost & Pricing Telemetry
            "total_cost": total_cost,
            "total_spent": total_cost,
            "cost_per_message": rate,
            "currency": curr,
            "service_quota": service_quota,
            "service_cost": service_cost_month,

            # Unifonic Channel Breakdown & Spending
            "channel": "Whatsapp",
            "messages_sent": total_sent,
            "messages_received": inbound_count,
            "messages_delivered": delivered_total,
            "marketing_lite": marketing_lite_count,
            "utility": utility_count,
            "marketing": marketing_count,
            "authentication": authentication_count,
            "service": service_count,
            "estimated_spending_bi": f"{bi_spending:.2f}",
            "estimated_spending_ui": f"{ui_spending:.2f}",

            # Compatibility fields
            "total_sent": total_sent,
            "pending_sent": unconfirmed_count,
            "delivery_rate": delivery_rate,
            "read_rate": read_rate,
            "failure_rate": failure_rate
        }

    def get_events(self, limit: int = 2000) -> List[Dict[str, Any]]:
        events = self._read_all_jsonl()
        return events[-limit:] if limit else events

    def get_recent_events(self, limit: int = 50) -> List[Dict[str, Any]]:
        events = self._read_all_jsonl()
        return list(reversed(events[-limit:]))

    def get_all_message_ids(self, limit: int = 200) -> List[str]:
        import re
        UUID_REGEX = re.compile(r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
        ids = []
        seen = set()

        # Prioritize recent campaign message IDs from registered dispatch logs
        for m in reversed(list(self.campaign_message_ids.keys())):
            clean = str(m).strip()
            if UUID_REGEX.match(clean) and clean not in seen:
                seen.add(clean)
                ids.append(clean)
                if len(ids) >= limit:
                    return ids

        # Also from JSONL
        for ev in reversed(self._read_all_jsonl()):
            m = ev.get("message_id")
            if m:
                clean = str(m).strip()
                if UUID_REGEX.match(clean) and clean not in seen:
                    seen.add(clean)
                    ids.append(clean)
                    if len(ids) >= limit:
                        break

        return ids

    def update_unifonic_statuses(self, status_items: List[Dict[str, Any]]) -> int:
        updated = 0
        now_iso = datetime.now(timezone.utc).isoformat()
        for item in status_items:
            mid = item.get("messageId")
            st = item.get("status")
            if not mid or not st:
                continue

            statuses = item.get("statuses", [])
            delivered_at = None
            read_at = None
            for s in statuses:
                if s.get("status") == "DELIVERED":
                    delivered_at = s.get("createdAt")
                elif s.get("status") == "READ":
                    read_at = s.get("createdAt")

            # Update in Mongo
            if self.is_mongo_connected():
                try:
                    update_fields = {
                        "status": st,
                        "unifonic_sync_at": now_iso,
                        "raw_unifonic_status": item
                    }
                    if delivered_at:
                        update_fields["delivered_at"] = delivered_at
                    if read_at:
                        update_fields["read_at"] = read_at

                    res = self.collection.update_many(
                        {"message_id": mid},
                        {"$set": update_fields}
                    )
                    if res.modified_count > 0:
                        updated += 1
                except Exception as e:
                    logger.warning(f"Error updating Mongo status for {mid}: {e}")

            # Also write sync event to JSONL
            ev_data = {
                "event_type": "delivery_status",
                "message_id": mid,
                "status": st,
                "customer_phone": extract_phone_number(item.get("contact")),
                "delivered_at": delivered_at,
                "read_at": read_at,
                "received_at": now_iso,
                "direction": "status_update",
                "raw_payload": item
            }
            self._append_jsonl(ev_data)
            updated += 1

        return updated

storage = StorageManager()

