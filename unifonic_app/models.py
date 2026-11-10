import re
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Union, List
from pydantic import BaseModel, Field

class NormalizedWhatsAppEvent(BaseModel):
    id: Optional[str] = None
    event_type: str = "unknown"  # "inbound_message" | "outbound_message" | "delivery_status" | "unknown"
    sender: Optional[str] = None
    recipient: Optional[str] = None
    customer_phone: Optional[str] = None
    message_id: Optional[str] = None
    status: Optional[str] = None
    content: Optional[str] = None
    attachments: List[Dict[str, Any]] = Field(default_factory=list)
    error: Optional[str] = None
    channel: str = "whatsapp"
    ad_source: Optional[str] = None  # "meta_ads" | "snapchat_ads" | "organic" | "broadcast"
    ad_campaign: Optional[str] = None
    ad_keyword: Optional[str] = None
    raw_payload: Dict[str, Any] = Field(default_factory=dict)
    # Meta / WhatsApp Pricing Telemetry
    pricing_category: Optional[str] = None  # "service" | "utility" | "marketing" | "authentication"
    pricing_type: Optional[str] = None      # "free_customer_service" | "regular"
    billable: Optional[bool] = None         # True | False
    pricing_model: Optional[str] = None     # "PMP" | "CBP"
    received_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

def extract_phone_number(val: Any) -> Optional[str]:
    """
    Extracts and normalizes a clean phone number from various formats:
    - String: "+966559421442", "0559421442", "966559421442"
    - Dict: {"contact": "+966...", "channel": "whatsapp", "userId": "..."}
    - Dict: {"recipientId": "966..."}
    """
    if not val:
        return None

    # If it's a dict, inspect common keys
    if isinstance(val, dict):
        raw = val.get("contact") or val.get("recipientId") or val.get("phone") or val.get("number") or val.get("id") or ""
        return extract_phone_number(raw)

    # Convert to string and handle stringified dicts (e.g. "{'contact': '...'}")
    s = str(val).strip()
    if s.startswith("{") and "contact" in s:
        m = re.search(r"['\"]contact['\"]\s*:\s*['\"]([^'\"]+)['\"]", s)
        if m:
            s = m.group(1)
        else:
            m2 = re.search(r"['\"]recipientId['\"]\s*:\s*['\"]([^'\"]+)['\"]", s)
            if m2:
                s = m2.group(1)

    # Remove all non-digits
    digits = re.sub(r"\D", "", s)
    if not digits:
        return None

    # Handle local Saudi numbers (05xxxxxxxx -> 9665xxxxxxxx)
    if digits.startswith("05") and len(digits) == 10:
        digits = "966" + digits[1:]
    elif digits.startswith("5") and len(digits) == 9:
        digits = "966" + digits

    return digits

def extract_event_timestamp(payload: Dict[str, Any]) -> str:
    """
    Extracts the true customer message timestamp (when customer sent / Unifonic gateway received),
    prioritizing customer send time over server/webhook reception time.
    """
    if not isinstance(payload, dict):
        return datetime.now(timezone.utc).isoformat()

    candidates = [
        payload.get("timestamp"),
        payload.get("receivedAt"),
        payload.get("sentAt"),
        payload.get("sent_at"),
        payload.get("createdAt"),
        payload.get("created_at"),
        payload.get("time"),
        payload.get("Date"),
        (payload.get("message") or {}).get("timestamp") if isinstance(payload.get("message"), dict) else None,
        (payload.get("content") or {}).get("timestamp") if isinstance(payload.get("content"), dict) else None,
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
    return datetime.now(timezone.utc).isoformat()

def extract_ad_attribution(payload: Dict[str, Any], content_text: Optional[str]) -> Dict[str, Optional[str]]:
    """
    Detects if an incoming message was triggered by Meta Ads (CTWA) or Snapchat Ads (Swipe Up / wa.me link).
    """
    ad_source = None
    ad_campaign = None
    ad_keyword = None

    # 1. Check Meta CTWA referral object in webhook
    referral = payload.get("referral") or (payload.get("context", {}).get("referral") if isinstance(payload.get("context"), dict) else None)
    if isinstance(referral, dict):
        ad_source = "meta_ads"
        ad_campaign = referral.get("headline") or referral.get("source_id") or referral.get("source_url")
        ad_keyword = referral.get("ctwa_clid") or referral.get("source_id")
        return {"ad_source": ad_source, "ad_campaign": str(ad_campaign) if ad_campaign else None, "ad_keyword": str(ad_keyword) if ad_keyword else None}

    # 2. Check text for Snap / Meta / Promo signatures
    if content_text:
        text_upper = content_text.upper()
        # Snapchat patterns
        if any(k in text_upper for k in ["SNAP", "سناب", "SNAPCHAT", "SNAP_", "#SNAP", "SNAP96", "SWIPE"]):
            ad_source = "snapchat_ads"
            m = re.search(r"(SNAP[\w\d_-]+|سناب[\w\d_-]*)", content_text, re.IGNORECASE)
            ad_keyword = m.group(1) if m else "snapchat_ad_link"
            ad_campaign = "Snapchat Acquisition"
        # Meta (Instagram / Facebook) patterns
        elif any(k in text_upper for k in ["META", "INSTAGRAM", "انستقرام", "انستغرام", "FACEBOOK", "فيسبوك", "IG_", "FB_", "#META", "#IG"]):
            ad_source = "meta_ads"
            m = re.search(r"(META[\w\d_-]+|IG[\w\d_-]+|FB[\w\d_-]+)", content_text, re.IGNORECASE)
            ad_keyword = m.group(1) if m else "meta_ctwa_ad"
            ad_campaign = "Meta CTWA Campaign"
        # Special campaign tags (e.g. Watan96 / Rush Wash Promo)
        elif any(k in text_upper for k in ["WATAN96", "وطن96", "العيد الوطني", "96SAR", "96_SAR", "96_PROMO"]):
            ad_campaign = "Watan96 Promo"
            ad_keyword = "WATAN96"

    return {"ad_source": ad_source, "ad_campaign": ad_campaign, "ad_keyword": ad_keyword}


def parse_unifonic_event(payload: Dict[str, Any]) -> NormalizedWhatsAppEvent:
    """
    Parses live Unifonic WhatsApp webhook payloads into a uniform structure.
    Handles:
      - Unifonic Conversations API event types:
        - "message.sent"
        - "message.delivered"
        - "message.read"
        - "message.rejected" / "message.failed"
        - "message.received" / "message.incoming"
      - Legacy and form-encoded formats
    """
    ev_type = str(payload.get("eventType") or payload.get("event") or payload.get("type") or "").lower()
    
    # Extract message ID
    message_id = (
        payload.get("messageId")
        or payload.get("message_id")
        or payload.get("MessageID")
        or payload.get("id")
        or (payload.get("data", {}).get("messageId") if isinstance(payload.get("data"), dict) else None)
    )

    event_time = extract_event_timestamp(payload)

    # 1. Check for Unifonic Conversations API Delivery Status Callbacks
    # e.g. "message.sent", "message.delivered", "message.read", "message.rejected"
    if any(k in ev_type for k in ["sent", "deliv", "read", "reject", "fail", "status", "dlr"]):
        status_val = "SENT"
        if "deliv" in ev_type:
            status_val = "DELIVERED"
        elif "read" in ev_type:
            status_val = "READ"
        elif "reject" in ev_type or "fail" in ev_type:
            status_val = "FAILED"
        elif payload.get("status"):
            st_raw = str(payload.get("status")).upper()
            if "DELIV" in st_raw: status_val = "DELIVERED"
            elif "READ" in st_raw: status_val = "READ"
            elif "FAIL" in st_raw or "REJECT" in st_raw: status_val = "FAILED"
            else: status_val = "SENT"

        recipient_phone = extract_phone_number(
            payload.get("recipient") or payload.get("recipientId") or payload.get("to") or payload.get("contact")
        )
        sender_phone = extract_phone_number(payload.get("sender") or payload.get("from"))
        fail_reason = payload.get("failReason") or payload.get("error") or payload.get("reason")
        # Extract Meta / Unifonic Pricing Telemetry
        pricing_data = payload.get("pricing")
        if not pricing_data and isinstance(payload.get("data"), dict):
            pricing_data = payload.get("data", {}).get("pricing")
        if not pricing_data and isinstance(payload.get("status"), dict):
            pricing_data = payload.get("status", {}).get("pricing")

        billable_val = None
        pricing_cat = None
        pricing_type = None
        pricing_model = None

        if isinstance(pricing_data, dict):
            billable_raw = pricing_data.get("billable")
            if billable_raw is not None:
                billable_val = bool(billable_raw)
            pricing_cat = pricing_data.get("category")
            pricing_type = pricing_data.get("type")
            pricing_model = pricing_data.get("pricing_model")

        return NormalizedWhatsAppEvent(
            event_type="delivery_status",
            status=status_val,
            recipient=recipient_phone,
            sender=sender_phone,
            customer_phone=recipient_phone,
            message_id=str(message_id) if message_id else None,
            content=None,
            error=str(fail_reason) if fail_reason else None,
            pricing_category=str(pricing_cat) if pricing_cat else None,
            pricing_type=str(pricing_type) if pricing_type else None,
            billable=billable_val,
            pricing_model=str(pricing_model) if pricing_model else None,
            received_at=event_time,
            raw_payload=payload
        )

    # 2. Check for Inbound Customer WhatsApp Message
    # e.g. "message.received", "message.incoming", "incoming_message"
    sender_phone = extract_phone_number(
        payload.get("from") or payload.get("sender") or payload.get("senderId") or payload.get("source")
    )
    recipient_phone = extract_phone_number(
        payload.get("to") or payload.get("recipient") or payload.get("recipientId")
    )

    # Extract text content and attachments
    content_text = None
    attachments = []
    
    raw_content = payload.get("content") if isinstance(payload.get("content"), dict) else {}
    raw_msg = payload.get("message") if isinstance(payload.get("message"), dict) else {}

    # 1. Extract text / caption
    content_text = raw_content.get("text") or raw_msg.get("text") or raw_msg.get("body") or payload.get("text") or payload.get("body") or payload.get("message")
    
    # 2. Extract attachments from content.attachments list
    if isinstance(raw_content.get("attachments"), list):
        for att in raw_content["attachments"]:
            if isinstance(att, dict) and (att.get("url") or att.get("mediaUrl")):
                attachments.append(att)
    elif isinstance(payload.get("attachments"), list):
        for att in payload["attachments"]:
            if isinstance(att, dict) and (att.get("url") or att.get("mediaUrl")):
                attachments.append(att)

    # 3. Extract media from content.media list
    if isinstance(raw_content.get("media"), list):
        for m in raw_content["media"]:
            if isinstance(m, dict) and (m.get("url") or m.get("mediaUrl")):
                attachments.append(m)

    # 4. Extract direct mediaUrl / imageUrl fields
    for direct_key in ["mediaUrl", "media_url", "url", "imageUrl", "image_url", "fileUrl", "file_url"]:
        u = raw_content.get(direct_key) or raw_msg.get(direct_key) or payload.get(direct_key)
        if u and isinstance(u, str) and u.startswith("http"):
            attachments.append({"url": u, "type": "image"})

    # If content_text is empty but attachments exist, use caption or default label
    if not content_text and attachments:
        caption = raw_content.get("caption") or raw_msg.get("caption") or payload.get("caption")
        content_text = caption or "[Image / Attachment]"

    attr = extract_ad_attribution(payload, content_text)

    return NormalizedWhatsAppEvent(
        event_type="inbound_message",
        sender=sender_phone,
        recipient=recipient_phone,
        customer_phone=sender_phone,
        message_id=str(message_id) if message_id else None,
        content=str(content_text) if content_text else None,
        attachments=attachments,
        ad_source=attr.get("ad_source"),
        ad_campaign=attr.get("ad_campaign"),
        ad_keyword=attr.get("ad_keyword"),
        received_at=event_time,
        raw_payload=payload
    )
