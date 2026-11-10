import os
import re
import requests
import logging
from typing import Dict, Any, Optional
from unifonic_app.config import (
    UNIFONIC_APP_ID,
    UNIFONIC_PUBLIC_ID,
    UNIFONIC_SECRET_KEY,
    UNIFONIC_CHANNEL_ID,
    UNIFONIC_CONVERSATIONS_URL
)

logger = logging.getLogger("unifonic_app.client")

def format_e164_phone(phone: str) -> str:
    """
    Normalizes a phone number to standard E.164 format with a leading '+'
    as strictly required by Unifonic API (regex: ^\\+[1-9]\\d{1,14}$).
    """
    digits = re.sub(r"\D", "", str(phone).strip())
    if digits.startswith("00"):
        digits = digits[2:]
    elif digits.startswith("05") and len(digits) == 10:
        digits = "966" + digits[1:]
    elif digits.startswith("5") and len(digits) == 9:
        digits = "966" + digits
    elif not digits.startswith("966") and len(digits) == 9:
        digits = "966" + digits

    return f"+{digits}"

def send_whatsapp_message(
    to_phone: str,
    text: Optional[str] = None,
    public_id: Optional[str] = None,
    secret_key: Optional[str] = None,
    channel_id: Optional[str] = None,
    media_url: Optional[str] = None,
    template_name: Optional[str] = None,
    template_language: Optional[str] = "ar",
    template_components: Optional[list] = None,
    template_vars: Optional[list] = None
) -> Dict[str, Any]:
    """
    Sends an outbound WhatsApp message via Unifonic Conversations API.
    Supports official WhatsApp Templates (type="template") for business-initiated broadcasts
    and freeform text/media (type="text" / type="image") for 24h customer sessions.
    """
    pid = (public_id or UNIFONIC_PUBLIC_ID or "").strip()
    secret = (secret_key or UNIFONIC_SECRET_KEY or "").strip()

    if not secret:
        logger.warning(f"Cannot send WhatsApp message to {to_phone}: UNIFONIC_SECRET_KEY is not configured.")
        return {
            "success": False,
            "message_id": None,
            "status": "FAILED",
            "error": "Unifonic API Secret Key is missing. Please configure it in settings."
        }

    formatted_contact = format_e164_phone(to_phone)
    cid = (channel_id or UNIFONIC_CHANNEL_ID or "").strip()

    # 1. Determine if official Meta WhatsApp Template should be used
    tpl_name = template_name.strip() if template_name else None
    
    # Auto-detect pre-approved templates if template_name is not explicitly passed
    if not tpl_name and text:
        clean_text = text.strip()
        if "96 ريال شهريًا" in clean_text or "96_sar" in clean_text:
            tpl_name = "96_sar_media" if media_url else "96_sar"
        elif "حياك الله في رش! غسلتك الأولى علينا" in clean_text:
            if template_vars or re.search(r"\{\{.*\}\}", clean_text) or "FIRSTWASH" not in clean_text:
                tpl_name = "firstwash_bulk"
            else:
                tpl_name = "firstwash"
        elif "0553123848" in clean_text or "مرحبًا بكم في رش واش" in clean_text:
            tpl_name = "reply"
        elif "سيارات أكثر" in clean_text or "باقة العائلة" in clean_text or "family_plan" in clean_text:
            tpl_name = "family_plan"

    # Default image header for templates that mandate an IMAGE header
    if tpl_name == "family_plan" and not media_url:
        media_url = "https://scontent.whatsapp.net/v/t61.29466-34/637158105_934429379397525_8548669738842225767_n.png?ccb=1-7&_nc_sid=8b1bef&_nc_ohc=sBtEdpctWo8Q7kNvwGP7fRc&_nc_oc=Adq8tPAwamSWuiUlAuBRbrvTo6wHzImHa0HEtqHi7Pu5myv4-HfCFMEr4fRsNpy8aeI&_nc_zt=3&_nc_ht=scontent.whatsapp.net&edm=AH51TzQEAAAA&_nc_gid=wsAOJvsedg8kGXl7pAyT5g&_nc_tpa=Q5bMBQJMl0JU-O5W1hHFquJ-j7qI2LznrBkOILqM_OVzP3Kb13Uhiyl4P_Cebb4S0qKSPHsmtNuozSQbyg&oh=01_Q5Aa5wF5AW4r-8VkmhKnORkqaBGLSoBVfmVC8oMR89ETLCxxbg&oe=6AECB58F"

    if tpl_name:
        content_dict: Dict[str, Any] = {
            "type": "template",
            "name": tpl_name,
            "language": {
                "code": template_language or "ar"
            }
        }

        components = []
        if template_components is not None:
            components = template_components
        else:
            # 1. Header component (image)
            if media_url:
                components.append({
                    "type": "header",
                    "parameters": [
                        {
                            "type": "image",
                            "url": media_url
                        }
                    ]
                })

            # 2. Body component (dynamic variables)
            if template_vars and len(template_vars) > 0:
                components.append({
                    "type": "body",
                    "parameters": [
                        {"type": "text", "text": str(v)} for v in template_vars
                    ]
                })

        if components:
            content_dict["components"] = components

        payload = {
            "recipient": {
                "contact": formatted_contact,
                "channel": "whatsapp"
            },
            "content": content_dict
        }
    elif media_url:
        payload = {
            "recipient": {
                "contact": formatted_contact,
                "channel": "whatsapp"
            },
            "content": {
                "type": "image",
                "media": [{"url": media_url}],
                "text": text or ""
            }
        }
    else:
        payload = {
            "recipient": {
                "contact": formatted_contact,
                "channel": "whatsapp"
            },
            "content": {
                "type": "text",
                "text": text or ""
            }
        }

    # Optional channelId if specific channel is targeted
    if cid:
        payload["recipient"]["channelId"] = cid

    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "publicId": pid,
        "secret": secret
    }

    logger.info(f"Dispatching WhatsApp message to {formatted_contact} (type: {payload['content']['type']}) via {UNIFONIC_CONVERSATIONS_URL}")

    try:
        response = requests.post(UNIFONIC_CONVERSATIONS_URL, json=payload, headers=headers, timeout=15)
        resp_data = {}
        try:
            resp_data = response.json()
        except Exception:
            resp_data = {"raw_response": response.text}

        if response.status_code in [200, 201, 202]:
            msg_id = resp_data.get("messageId") or resp_data.get("id") or resp_data.get("data", {}).get("messageId")
            logger.info(f"WhatsApp message sent successfully: MessageID={msg_id}")
            return {
                "success": True,
                "message_id": str(msg_id) if msg_id else None,
                "status": "SENT",
                "response": resp_data
            }
        else:
            err_msg = resp_data.get("message") or resp_data.get("error") or f"HTTP {response.status_code}"
            logger.warning(f"Unifonic WhatsApp API error ({response.status_code}): {err_msg}")
            return {
                "success": False,
                "message_id": None,
                "status": "FAILED",
                "error": str(err_msg),
                "http_status": response.status_code,
                "response": resp_data
            }
    except Exception as e:
        logger.error(f"Failed to connect to Unifonic WhatsApp API: {e}")
        return {
            "success": False,
            "message_id": None,
            "status": "FAILED",
            "error": str(e)
        }

def get_messages_status(
    message_ids: list,
    public_id: Optional[str] = None,
    secret_key: Optional[str] = None
) -> list:
    """
    Executes GET requests to Unifonic Conversations API to retrieve live delivery status
    and transition history for a list of message IDs.
    Endpoint: GET https://apis.unifonic.com/v1/messages/status?messageIds=...
    """
    pid = (public_id or UNIFONIC_PUBLIC_ID or "").strip()
    secret = (secret_key or UNIFONIC_SECRET_KEY or "").strip()

    if not message_ids or not pid or not secret:
        return []

    headers = {
        "Accept": "application/json",
        "PublicId": pid,
        "Secret": secret,
        "publicId": pid,
        "secret": secret
    }

    results = []
    chunk_size = 50
    import re
    UUID_REGEX = re.compile(r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
    clean_ids = [str(m).strip() for m in message_ids if m and UUID_REGEX.match(str(m).strip())]
    if not clean_ids:
        return []

    for i in range(0, len(clean_ids), chunk_size):
        batch = clean_ids[i:i + chunk_size]
        url = f"https://apis.unifonic.com/v1/messages/status?messageIds={','.join(batch)}"
        try:
            logger.info(f"GET status from Unifonic: {len(batch)} message IDs")
            resp = requests.get(url, headers=headers, timeout=5)
            if resp.status_code in [200, 201]:
                data = resp.json()
                if isinstance(data, list):
                    results.extend(data)
                elif isinstance(data, dict):
                    results.append(data)
            else:
                logger.warning(f"Unifonic GET status error ({resp.status_code}): {resp.text}")
        except Exception as e:
            logger.error(f"Failed to GET status from Unifonic: {e}")

    return results


def fetch_missed_inbound_messages(
    public_id: Optional[str] = None,
    secret_key: Optional[str] = None,
    channel_id: Optional[str] = None,
    max_conversations: int = 50,
    messages_per_conversation: int = 20,
) -> list:
    """
    Polls Unifonic's Conversations API to recover inbound messages that were
    missed while the webhook was offline.

    Flow:
      1. GET /v1/conversations           → list recent conversation threads
      2. GET /v1/conversations/{id}/messages → fetch messages for each thread
      3. Return only direction=INBOUND messages so callers can save them.

    Returns a list of raw message dicts (each contains at minimum: id, direction,
    content, sender/recipient, createdAt).
    """
    pid = (public_id or UNIFONIC_PUBLIC_ID or "").strip()
    secret = (secret_key or UNIFONIC_SECRET_KEY or "").strip()
    cid = (channel_id or UNIFONIC_CHANNEL_ID or "").strip()

    if not pid or not secret:
        logger.warning("fetch_missed_inbound_messages: missing credentials, aborting.")
        return []

    headers = {
        "Accept": "application/json",
        "publicId": pid,
        "secret": secret,
    }

    # ── Step 1: list conversations ──────────────────────────────────────────
    conv_url = "https://apis.unifonic.com/v1/conversations"
    params: dict = {"limit": max_conversations}
    if cid:
        params["channelId"] = cid

    try:
        resp = requests.get(conv_url, headers=headers, params=params, timeout=15)
        if resp.status_code not in [200, 201]:
            logger.warning(
                f"[RecoverInbound] GET /v1/conversations failed ({resp.status_code}): {resp.text[:300]}"
            )
            return []
        data = resp.json()
    except Exception as e:
        logger.error(f"[RecoverInbound] Request error listing conversations: {e}")
        return []

    # Handle both list and {"data": [...]} shapes
    if isinstance(data, list):
        conversations = data
    elif isinstance(data, dict):
        conversations = data.get("data") or data.get("conversations") or data.get("items") or []
    else:
        conversations = []

    logger.info(f"[RecoverInbound] Found {len(conversations)} conversation(s) to scan.")

    # ── Step 2: fetch messages for each conversation ────────────────────────
    inbound_messages = []

    for conv in conversations:
        conv_id = conv.get("id") or conv.get("conversationId")
        if not conv_id:
            continue

        msg_url = f"https://apis.unifonic.com/v1/conversations/{conv_id}/messages"
        msg_params = {"limit": messages_per_conversation}

        try:
            msg_resp = requests.get(msg_url, headers=headers, params=msg_params, timeout=15)
            if msg_resp.status_code not in [200, 201]:
                logger.warning(
                    f"[RecoverInbound] GET messages for conv {conv_id} failed "
                    f"({msg_resp.status_code}): {msg_resp.text[:200]}"
                )
                continue
            msg_data = msg_resp.json()
        except Exception as e:
            logger.error(f"[RecoverInbound] Error fetching messages for conv {conv_id}: {e}")
            continue

        if isinstance(msg_data, list):
            messages = msg_data
        elif isinstance(msg_data, dict):
            messages = msg_data.get("data") or msg_data.get("messages") or msg_data.get("items") or []
        else:
            messages = []

        for msg in messages:
            direction = str(msg.get("direction") or msg.get("type") or "").upper()
            # Keep only messages sent by the customer (INBOUND / RECEIVED)
            if direction in ("INBOUND", "RECEIVED", "IN") or "INBOUND" in direction:
                msg["_conversation_id"] = conv_id
                inbound_messages.append(msg)

    logger.info(f"[RecoverInbound] Recovered {len(inbound_messages)} inbound message(s).")
    return inbound_messages


def get_whatsapp_templates(
    public_id: Optional[str] = None,
    secret_key: Optional[str] = None
) -> list:
    """
    Fetches pre-approved WhatsApp message templates directly from Unifonic Management API.
    Endpoint: GET https://apis.unifonic.com/v1/whatsapp/message_templates
    """
    pid = (public_id or UNIFONIC_PUBLIC_ID or "").strip()
    secret = (secret_key or UNIFONIC_SECRET_KEY or "").strip()

    fallback_templates = []

    if not pid or not secret:
        return []

    headers = {
        "Accept": "application/json",
        "publicId": pid,
        "secret": secret
    }

    url = "https://apis.unifonic.com/v1/whatsapp/message_templates"
    templates_list = []
    try:
        resp = requests.get(url, headers=headers, timeout=10)
        if resp.status_code in [200, 201]:
            data = resp.json()
            if isinstance(data, list) and len(data) > 0:
                logger.info(f"Retrieved {len(data)} WhatsApp templates from Unifonic API.")
                templates_list = data
            elif isinstance(data, dict) and "data" in data and len(data["data"]) > 0:
                logger.info(f"Retrieved {len(data['data'])} WhatsApp templates from Unifonic API.")
                templates_list = data["data"]
        else:
            logger.warning(f"Unifonic get_whatsapp_templates returned {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        logger.error(f"Failed to fetch templates from Unifonic: {e}")

    if not templates_list:
        templates_list = fallback_templates

    # Merge custom created templates if any
    from unifonic_app.config import CUSTOM_TEMPLATES_FILE
    import json
    if CUSTOM_TEMPLATES_FILE.exists():
        try:
            with open(CUSTOM_TEMPLATES_FILE, "r", encoding="utf-8") as f:
                custom_tpls = json.load(f)
                if isinstance(custom_tpls, list):
                    custom_map = {ct.get("name"): ct for ct in custom_tpls if isinstance(ct, dict) and ct.get("name")}
                    new_list = []
                    existing_names = set()
                    for t in templates_list:
                        tname = t.get("name")
                        if tname in custom_map:
                            t = {**t, **custom_map[tname]}
                        new_list.append(t)
                        existing_names.add(tname)
                    for cname, ct in custom_map.items():
                        if cname not in existing_names:
                            new_list.insert(0, ct)
                    templates_list = new_list
        except Exception as ce:
            logger.warning(f"Error loading custom templates file: {ce}")

    return templates_list


def get_approved_templates(
    category: Optional[str] = None,
    language: Optional[str] = None,
    public_id: Optional[str] = None,
    secret_key: Optional[str] = None
) -> list:
    """
    Returns WhatsApp templates that have status APPROVED, optionally filtered by category or language.
    """
    all_tpls = get_whatsapp_templates(public_id=public_id, secret_key=secret_key)
    approved = [t for t in all_tpls if str(t.get("status", "")).strip().upper() == "APPROVED"]
    if category:
        cat_upper = category.strip().upper()
        approved = [t for t in approved if str(t.get("category", "")).strip().upper() == cat_upper]
    if language:
        lang_lower = language.strip().lower()
        approved = [t for t in approved if str(t.get("language", "")).strip().lower() == lang_lower]
    return approved


def create_whatsapp_template_api(
    name: str,
    body: str,
    category: str = "MARKETING",
    language: str = "ar",
    status: Optional[str] = "IN_REVIEW",
    media_url: Optional[str] = None,
    buttons: Optional[list] = None,
    meta_waba_id: Optional[str] = None,
    meta_access_token: Optional[str] = None,
    public_id: Optional[str] = None,
    secret_key: Optional[str] = None
) -> Dict[str, Any]:
    """
    Creates a new WhatsApp message template via Meta Graph API / Unifonic Management API
    and persists it in the local template registry with its review status.
    """
    import uuid
    import re
    from unifonic_app.config import CUSTOM_TEMPLATES_FILE
    import json

    # Sanitize name
    clean_name = re.sub(r'[^a-zA-Z0-9_]', '_', name.lower().strip())
    if not clean_name:
        clean_name = f"rush_template_{uuid.uuid4().hex[:6]}"

    # Extract dynamic parameters {{1}}, {{2}}...
    vars_found = re.findall(r"\{\{(\d+)\}\}", body)
    example_body = [f"sample_value_{i}" for i in range(1, len(vars_found) + 1)] if vars_found else []

    components = []
    
    # 1. Header component (if media_url provided)
    if media_url:
        components.append({
            "type": "HEADER",
            "format": "IMAGE",
            "example": {
                "header_handle": [media_url]
            }
        })

    # 2. Body component
    body_comp = {
        "type": "BODY",
        "text": body
    }
    if example_body:
        body_comp["example"] = {
            "body_text": [example_body]
        }
    components.append(body_comp)

    # 3. Buttons component (if provided)
    if buttons and isinstance(buttons, list) and len(buttons) > 0:
        formatted_buttons = []
        for b in buttons:
            if isinstance(b, dict):
                b_type = b.get("type", "URL").upper()
                if b_type == "URL":
                    formatted_buttons.append({
                        "type": "URL",
                        "text": b.get("text", "Visit Website"),
                        "url": b.get("url", "https://rush.com.sa/")
                    })
                elif b_type in ["QUICK_REPLY", "PHONE_NUMBER"]:
                    formatted_buttons.append({
                        "type": b_type,
                        "text": b.get("text", "Quick Reply")
                    })
        if formatted_buttons:
            components.append({
                "type": "BUTTONS",
                "buttons": formatted_buttons
            })

    meta_payload = {
        "name": clean_name,
        "category": category.upper(),
        "language": language.lower(),
        "components": components
    }

    template_id = str(uuid.uuid4().int)[:16]
    api_response = {}
    submitted_to_meta = False

    # Attempt Meta Direct Graph API if credentials provided
    waba = meta_waba_id or os.getenv("META_WABA_ID")
    token = meta_access_token or os.getenv("META_ACCESS_TOKEN")
    if waba and token:
        try:
            meta_url = f"https://graph.facebook.com/v20.0/{waba}/message_templates"
            meta_res = requests.post(meta_url, json=meta_payload, headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            }, timeout=12)
            api_response["meta"] = meta_res.json()
            if meta_res.status_code in [200, 201]:
                submitted_to_meta = True
                template_id = meta_res.json().get("id", template_id)
        except Exception as me:
            api_response["meta_error"] = str(me)

    # Determine initial status
    final_status = (status or "IN_REVIEW").strip().upper()
    if submitted_to_meta and not status:
        final_status = "IN_REVIEW"

    # Build standard template record
    template_record = {
        "id": str(template_id),
        "name": clean_name,
        "status": final_status,
        "category": category.upper(),
        "language": language.lower(),
        "components": components,
        "created_via_api": True,
        "api_response": api_response
    }

    # Persist in CUSTOM_TEMPLATES_FILE
    try:
        custom_list = []
        if CUSTOM_TEMPLATES_FILE.exists():
            with open(CUSTOM_TEMPLATES_FILE, "r", encoding="utf-8") as f:
                custom_list = json.load(f)
                if not isinstance(custom_list, list):
                    custom_list = []
        
        # Replace if exists with same name, or prepend
        custom_list = [t for t in custom_list if t.get("name") != clean_name]
        custom_list.insert(0, template_record)

        with open(CUSTOM_TEMPLATES_FILE, "w", encoding="utf-8") as f:
            json.dump(custom_list, f, ensure_ascii=False, indent=2)
    except Exception as se:
        logger.error(f"Error persisting custom template: {se}")

    return {
        "success": True,
        "template": template_record,
        "message": f"Template '{clean_name}' created successfully with status '{final_status}'."
    }


def update_template_status(name: str, new_status: str) -> Dict[str, Any]:
    """
    Updates the review / approval status for a template in the local registry.
    """
    from unifonic_app.config import CUSTOM_TEMPLATES_FILE
    import json

    clean_name = name.strip()
    status_upper = new_status.strip().upper()

    custom_list = []
    if CUSTOM_TEMPLATES_FILE.exists():
        try:
            with open(CUSTOM_TEMPLATES_FILE, "r", encoding="utf-8") as f:
                custom_list = json.load(f)
                if not isinstance(custom_list, list):
                    custom_list = []
        except Exception:
            custom_list = []

    found = False
    for t in custom_list:
        if t.get("name", "").lower() == clean_name.lower():
            t["status"] = status_upper
            found = True
            break

    if not found:
        all_tpls = get_whatsapp_templates()
        for t in all_tpls:
            if t.get("name", "").lower() == clean_name.lower():
                copied = dict(t)
                copied["status"] = status_upper
                custom_list.insert(0, copied)
                found = True
                break

    try:
        with open(CUSTOM_TEMPLATES_FILE, "w", encoding="utf-8") as f:
            json.dump(custom_list, f, ensure_ascii=False, indent=2)
        return {"success": True, "name": clean_name, "status": status_upper}
    except Exception as e:
        return {"success": False, "error": str(e)}
