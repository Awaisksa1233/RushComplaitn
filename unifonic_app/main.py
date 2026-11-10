import io
import os
import re
import uuid
import csv
import json
import logging
import asyncio
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional, List, Set
from pathlib import Path
from pydantic import BaseModel

from fastapi import FastAPI, Request, Response, status, Query, UploadFile, File, Form
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import hashlib
import hmac

from unifonic_app.config import (
    APP_DIR,
    UPLOADS_DIR,
    LOCAL_PORT,
    VPS_HOST,
    VPS_PORT,
    PUBLIC_HTTPS_URL,
    PUBLIC_HTTPS_ALT_URL,
    PUBLIC_DIRECT_IP_URL,
    DB_NAME,
    UNIFONIC_APP_ID,
    UNIFONIC_CHANNEL_ID,
    AUTH_USERNAME,
    AUTH_PASSWORD,
    SESSION_SECRET,
    DEFAULT_COST_MARKETING,
    DEFAULT_COST_UTILITY,
    DEFAULT_COST_AUTH,
    DEFAULT_COST_SERVICE,
    DEFAULT_CURRENCY
)
from unifonic_app.models import parse_unifonic_event, extract_phone_number
from unifonic_app.storage import storage
from unifonic_app import db as _db
from unifonic_app.config import STORAGE_BACKEND as _STORAGE_BACKEND
from unifonic_app.ads_service import ads_service
from unifonic_app.link_tracker import link_tracker, TRANSPARENT_1X1_GIF
from unifonic_app.unifonic_client import (
    format_e164_phone,
    send_whatsapp_message,
    get_messages_status,
    fetch_missed_inbound_messages,
    get_whatsapp_templates,
    get_approved_templates,
    create_whatsapp_template_api,
    UNIFONIC_PUBLIC_ID,
    UNIFONIC_SECRET_KEY,
    UNIFONIC_CHANNEL_ID
)
from unifonic_app.chatwoot_bridge import (
    sync_inbound_to_chatwoot,
    sync_outbound_to_chatwoot,
    sync_dlr_to_chatwoot,
    record_chatwoot_unifonic_msg_mapping,
    verify_chatwoot_webhook_signature,
    CHATWOOT_WEBHOOK_SECRET,
)
from unifonic_app.campaign_manager import campaign_manager
from unifonic_app import bot as whatsapp_bot
from unifonic_app.ads_service import ads_service
from unifonic_app.ui_templates import login_html as render_login_html, full_solution_ui as render_full_solution_ui
from unifonic_app.cron_dashboard_ui import render_cron_dashboard_html
from unifonic_app.event_bus import publish_event, read_new_events, current_position

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("unifonic_app")

app = FastAPI(
    title="RushWash &bull; WhatsApp Hub & Delivery Reports",
    description="Enterprise WhatsApp Live Chat, DLR Reports, and Webhook Hub.",
    version="2.2.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Apple Wallet membership cards
from unifonic_app.config import WALLET_ENABLED as _WALLET_ENABLED
if _WALLET_ENABLED:
    from unifonic_app.wallet.routes import router as wallet_router, sync_loop as _wallet_sync_loop
    app.include_router(wallet_router)

    @app.on_event("startup")
    async def _start_wallet_sync():
        asyncio.create_task(_wallet_sync_loop())

# Mount local media uploads directory for public direct link access
app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")

# Rush Wash design system assets (fonts, logos, patterns, tokens CSS)
app.mount(
    "/static",
    StaticFiles(directory=os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")),
    name="static",
)

# Realtime Event Broadcaster (SSE)
class EventBroadcaster:
    def __init__(self):
        self.listeners: List[asyncio.Queue] = []

    async def subscribe(self) -> asyncio.Queue:
        q = asyncio.Queue()
        self.listeners.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue):
        if q in self.listeners:
            self.listeners.remove(q)

    async def broadcast(self, data: dict):
        dead_queues = []
        for q in list(self.listeners):
            try:
                q.put_nowait(data)
            except Exception:
                dead_queues.append(q)
        for dq in dead_queues:
            self.unsubscribe(dq)

broadcaster = EventBroadcaster()

# Authentication Utilities
EXPECTED_AUTH_TOKEN = hashlib.sha256(f"{AUTH_USERNAME}:{AUTH_PASSWORD}:{SESSION_SECRET}".encode()).hexdigest()

def is_authenticated(request: Request) -> bool:
    token = request.cookies.get("rush_session")
    if token and hmac.compare_digest(token, EXPECTED_AUTH_TOKEN):
        return True
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        bearer = auth_header.split(" ", 1)[1].strip()
        if hmac.compare_digest(bearer, EXPECTED_AUTH_TOKEN):
            return True
    return False

@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    # Public endpoints: tracking redirects, impression pixel, webhooks, health, login, logout, static/favicons, uploads media, SSE stream
    if (
        path.startswith("/r/")
        or path.startswith("/i/")
        or path.startswith("/px/")
        or path.startswith("/webhook")
        or path == "/health"
        or path == "/login"
        or path == "/logout"
        or path.startswith("/static")
        or path.startswith("/uploads")
        or path.startswith("/wallet/pass/")
        or path.startswith("/wallet/v1/")
        or path.startswith("/wallet/get")
        or path == "/wallet/api/sync"
        or path == "/favicon.ico"
        or path == "/api/events/stream"
        or path.startswith("/api/campaigns")
        or path.startswith("/api/waves")
        or path.startswith("/cron")
        or path == "/freewash"
        or path.startswith("/freewash")
        or path.startswith("/api/freewash")
        or path == "/ops/freewash"
        or path.startswith("/ops/freewash")
        or path == "/day23"
        or path.startswith("/day23")
        or path.startswith("/api/day23")
        or path == "/ops/day23-renewals"
        or path.startswith("/ops/day23-renewals")
        or path == "/ops"
        or path == "/ops/growth"
        or path.startswith("/ops/growth")
        or path == "/funnel"
        or path.startswith("/funnel")
        or path == "/growth"
        or path.startswith("/growth")
        or path == "/lifecycle"
        or path.startswith("/lifecycle")
        or path.startswith("/api/realtime")
        or path.startswith("/api/reports")
        or path.startswith("/api/system")
        or path == "/copilot"
        or path.startswith("/copilot/")
        or path.startswith("/api/copilot/")
        or path.startswith("/api/ops/")
        or (request.method in ("GET", "HEAD", "OPTIONS") and (path == "/api/templates" or path.startswith("/api/templates/")))
    ):
        return await call_next(request)

    if not is_authenticated(request):
        if path.startswith("/api/"):
            return JSONResponse(status_code=401, content={"error": "Unauthorized. Please sign in at /login."})
        return RedirectResponse(url="/login", status_code=302)

    return await call_next(request)

class LoginRequest(BaseModel):
    username: str
    password: str

class ReplyRequest(BaseModel):
    text: Optional[str] = None
    media_url: Optional[str] = None

class StartChatRequest(BaseModel):
    phone: str
    initial_message: Optional[str] = None
    media_url: Optional[str] = None

class CreateCampaignRequest(BaseModel):
    name: str
    message_template: str
    recipients: List[Dict[str, Any]]
    media_url: Optional[str] = None
    template_name: Optional[str] = None
    template_language: Optional[str] = "ar"
    delay_seconds: Optional[float] = 0.1

class CreateTemplateRequest(BaseModel):
    name: str
    body: str
    category: Optional[str] = "MARKETING"
    language: Optional[str] = "ar"
    status: Optional[str] = "IN_REVIEW"
    media_url: Optional[str] = None
    buttons: Optional[List[Dict[str, Any]]] = None
    meta_waba_id: Optional[str] = None
    meta_access_token: Optional[str] = None

class UpdateTemplateStatusRequest(BaseModel):
    status: str

class CreateLinkRequest(BaseModel):
    title: str
    destination_url: str
    slug: Optional[str] = None
    platform: Optional[str] = "snapchat"
    utm_source: Optional[str] = None
    utm_medium: Optional[str] = None
    utm_campaign: Optional[str] = None
    utm_content: Optional[str] = None
    utm_term: Optional[str] = None
    status: Optional[str] = "ACTIVE"

class UpdateLinkRequest(BaseModel):
    title: str
    destination_url: str
    slug: Optional[str] = None
    platform: Optional[str] = "snapchat"
    utm_source: Optional[str] = None
    utm_medium: Optional[str] = None
    utm_campaign: Optional[str] = None
    utm_content: Optional[str] = None
    utm_term: Optional[str] = None
    status: Optional[str] = "ACTIVE"

class SettingsRequest(BaseModel):
    public_id: Optional[str] = None
    secret_key: Optional[str] = None
    channel_id: Optional[str] = None
    cost_marketing: Optional[float] = None
    cost_utility: Optional[float] = None
    cost_auth: Optional[float] = None
    cost_service: Optional[float] = None
    currency: Optional[str] = None

current_settings = {
    "public_id": UNIFONIC_PUBLIC_ID,
    "secret_key": UNIFONIC_SECRET_KEY,
    "channel_id": UNIFONIC_CHANNEL_ID,
    "cost_marketing": DEFAULT_COST_MARKETING,
    "cost_utility": DEFAULT_COST_UTILITY,
    "cost_auth": DEFAULT_COST_AUTH,
    "cost_service": DEFAULT_COST_SERVICE,
    "currency": DEFAULT_CURRENCY
}

def login_html() -> str:
    return render_login_html()

@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    if is_authenticated(request):
        return RedirectResponse(url="/", status_code=302)
    return HTMLResponse(content=login_html())

@app.post("/login")
async def login_submit(req: LoginRequest):
    if req.username.strip() == AUTH_USERNAME and req.password.strip() == AUTH_PASSWORD:
        resp = JSONResponse(content={"success": True, "redirect": "/"})
        resp.set_cookie(
            key="rush_session",
            value=EXPECTED_AUTH_TOKEN,
            max_age=30 * 24 * 3600,
            httponly=True,
            samesite="lax",
            path="/"
        )
        return resp
    return JSONResponse(status_code=401, content={"success": False, "error": "Invalid username or password."})

@app.get("/logout")
async def logout():
    resp = RedirectResponse(url="/login", status_code=302)
    resp.delete_cookie(key="rush_session", path="/")
    return resp

# --- Webhook Ingestion Endpoints ---

def _database_label() -> str:
    return "SQLite (WAL) + JSONL mirror" if _STORAGE_BACKEND == "sqlite" else "JSONL journal (legacy, local)"


def _database_stats() -> dict:
    if _STORAGE_BACKEND != "sqlite":
        return {}
    try:
        return _db.stats()
    except Exception as e:
        return {"error": str(e)}


@app.get("/health")
async def health_check():
    mongo_ok = storage.is_mongo_connected()
    return {
        "status": "healthy",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "mongo_connected": mongo_ok,
        "database": _database_label(),
        "primary_webhook_url": PUBLIC_HTTPS_URL,
        "backup_webhook_url": PUBLIC_HTTPS_ALT_URL,
        "direct_ip_url": PUBLIC_DIRECT_IP_URL
    }

@app.get("/webhook/whatsapp")
async def verify_webhook(request: Request):
    params = dict(request.query_params)
    logger.info(f"[Webhook GET Ping] Query params: {params}")
    challenge = params.get("hub.challenge") or params.get("challenge") or params.get("hub_challenge")
    if challenge:
        return Response(content=str(challenge), media_type="text/plain")
    return {
        "status": "active",
        "message": "Unifonic WhatsApp Webhook endpoint is online and ready.",
        "primary_url": PUBLIC_HTTPS_URL
    }

@app.post("/webhook/whatsapp")
async def receive_webhook(request: Request):
    content_type = request.headers.get("content-type", "").lower()
    raw_payload: Dict[str, Any] = {}

    try:
        if "application/json" in content_type:
            raw_payload = await request.json()
        elif "form" in content_type:
            form_data = await request.form()
            raw_payload = dict(form_data)
        else:
            body_bytes = await request.body()
            if body_bytes:
                try:
                    raw_payload = json.loads(body_bytes.decode("utf-8"))
                except Exception:
                    raw_payload = {"raw_text": body_bytes.decode("utf-8", errors="ignore")}
    except Exception as e:
        logger.error(f"Error parsing request payload: {e}")
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={"status": "error", "message": f"Invalid payload: {str(e)}"}
        )

    event = parse_unifonic_event(raw_payload)

    divider = "=" * 60
    logger.info(f"\n{divider}\n[UNIFONIC WHATSAPP EVENT RECEIVED]\n"
                f"  Type:        {event.event_type.upper()}\n"
                f"  From:        {event.sender or 'N/A'}\n"
                f"  To:          {event.recipient or 'N/A'}\n"
                f"  Message ID:  {event.message_id or 'N/A'}\n"
                f"  Status:      {event.status or 'N/A'}\n"
                f"  Error:       {event.error or 'None'}\n"
                f"{divider}")

    save_result = storage.save_event(event)

    # Forward inbound customer WhatsApp messages to Chatwoot
    if event.event_type in ("inbound_message", "inbound", "message") and event.event_type != "outbound_message":
        cust_phone = event.customer_phone or event.sender
        if cust_phone and (event.content or event.attachments):
            try:
                logger.info(f"[Chatwoot Dispatch] Forwarding incoming WhatsApp from {cust_phone}: {str(event.content)[:60]} (attachments: {len(event.attachments)})")
                asyncio.create_task(asyncio.to_thread(
                    sync_inbound_to_chatwoot,
                    cust_phone,
                    event.content,
                    getattr(event, 'sender_name', None),
                    event.attachments
                ))
            except Exception as ce:
                logger.error(f"Chatwoot inbound dispatch error: {ce}")

    # AI auto-reply bot (restricted to BOT_TEST_NUMBERS inside bot.is_allowed)
    if event.event_type in ("inbound_message", "inbound", "message"):
        bot_phone = event.customer_phone or event.sender
        if bot_phone and whatsapp_bot.is_allowed(bot_phone):
            asyncio.create_task(asyncio.to_thread(
                whatsapp_bot.handle_inbound,
                bot_phone,
                event.content,
                getattr(event, 'sender_name', None),
                event.message_id
            ))

    # Forward DLR (Delivery / Read Receipt status) to Chatwoot
    if event.event_type == "delivery_status" or (event.status and event.status.upper() in ("SENT", "DELIVERED", "READ", "FAILED")):
        dlr_phone = event.customer_phone or event.recipient or event.sender
        if dlr_phone and event.status:
            try:
                logger.info(f"[Chatwoot DLR Dispatch] Syncing {event.status} for {dlr_phone} (msg_id: {event.message_id})")
                asyncio.create_task(asyncio.to_thread(
                    sync_dlr_to_chatwoot,
                    dlr_phone,
                    event.status,
                    event.message_id
                ))
            except Exception as de:
                logger.error(f"Chatwoot DLR dispatch error: {de}")

    # Realtime notification to all connected browser tabs
    sse_payload = {
        "type": "webhook_event",
        "event_type": event.event_type,
        "phone": event.customer_phone or event.sender or event.recipient,
        "content": event.content,
        "attachments": event.attachments,
        "status": event.status,
        "timestamp": event.received_at
    }
    try:
        asyncio.create_task(broadcaster.broadcast(sse_payload))
    except Exception as be:
        logger.debug(f"Broadcast error: {be}")
    publish_event(sse_payload)

    return {
        "status": "received",
        "event_type": event.event_type,
        "message_id": event.message_id,
        "saved_to_mongo": bool(save_result.get("mongo_id")),
        "timestamp": event.received_at
    }

@app.post("/webhook/chatwoot")
async def chatwoot_outbound_webhook(request: Request):
    """
    Receives outbound message events from Chatwoot when an agent replies
    and delivers them (including any media/images) to the customer via Unifonic WhatsApp API.
    """
    raw_body = await request.body()

    # Verify webhook signature when a secret is configured
    if CHATWOOT_WEBHOOK_SECRET:
        sig = request.headers.get("X-Chatwoot-Signature", "")
        ts = request.headers.get("X-Chatwoot-Timestamp")
        if not verify_chatwoot_webhook_signature(raw_body, sig, timestamp=ts):
            logger.warning("[Chatwoot Webhook] Invalid signature — request rejected.")
            return JSONResponse(status_code=401, content={"error": "Invalid webhook signature."})

    try:
        payload = json.loads(raw_body)
        event_type = payload.get("event")
        msg_type = payload.get("message_type")
        is_private = payload.get("private", False)

        if event_type == "message_created" and msg_type == "outgoing" and not is_private:
            # Check if this message was synced programmatically by our campaign/broadcast scripts
            content_attrs = payload.get("content_attributes") or {}
            sender = payload.get("sender") or {}
            sender_type = sender.get("type", "").lower()

            if content_attrs.get("is_campaign_sync") or content_attrs.get("campaign") or sender_type not in ["user", "agent"]:
                logger.info(f"[Chatwoot Outbound] Skipping programmatic/broadcast message (sender_type={sender_type}, is_campaign_sync={content_attrs.get('is_campaign_sync')})")
                return {"status": "ignored_campaign_or_system_sync"}

            conversation = payload.get("conversation", {})
            recipient_phone = None
            
            meta_sender = conversation.get("meta", {}).get("sender", {})
            if meta_sender and meta_sender.get("phone_number"):
                recipient_phone = meta_sender.get("phone_number")
            elif conversation.get("contact_inbox", {}).get("source_id"):
                recipient_phone = conversation.get("contact_inbox", {}).get("source_id")
            
            content = payload.get("content", "")
            
            # Check for attachments sent by agent in Chatwoot
            attachments = payload.get("attachments", [])
            media_url = None
            if attachments and isinstance(attachments, list) and len(attachments) > 0:
                first_att = attachments[0]
                media_url = first_att.get("data_url") or first_att.get("url")

            if recipient_phone and (content or media_url):
                logger.info(f"[Chatwoot Outbound] Forwarding agent reply to {recipient_phone}: {content[:60]}... (media: {media_url})")
                result = send_whatsapp_message(to_phone=recipient_phone, text=content, media_url=media_url)

                # Record Unifonic message ID -> Chatwoot message mapping for instant DLR matching
                unifonic_msg_id = result.get("message_id")
                chatwoot_msg_id = payload.get("id")
                conv_id = conversation.get("id")
                if unifonic_msg_id and chatwoot_msg_id and conv_id:
                    record_chatwoot_unifonic_msg_mapping(str(unifonic_msg_id), int(conv_id), int(chatwoot_msg_id))

                return {"status": "sent", "result": result}

        return {"status": "ignored"}
    except Exception as e:
        logger.error(f"[Chatwoot Outbound Webhook Error]: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})

# --- Realtime Server-Sent Events (SSE) Endpoint ---

@app.get("/api/events/stream")
async def events_stream(request: Request):
    async def event_generator():
        # Start from current end of file — only deliver new events
        pos = current_position()
        yield f"data: {json.dumps({'type': 'connected'})}\n\n"
        while True:
            if await request.is_disconnected():
                break
            events, pos = read_new_events(pos)
            for evt in events:
                yield f"data: {json.dumps(evt, ensure_ascii=False)}\n\n"
            if not events:
                yield ": keepalive\n\n"
            await asyncio.sleep(2.0)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

# --- Conversations & Chat API Endpoints ---

@app.get("/api/conversations")
async def list_conversations():
    convs = storage.get_conversations()
    return JSONResponse(
        content={"conversations": convs, "count": len(convs)},
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
        }
    )

@app.get("/api/conversations/{phone}/messages")
async def get_messages(phone: str):
    clean = extract_phone_number(phone)
    messages = storage.get_conversation_messages(clean)
    return JSONResponse(
        content={"phone": clean, "messages": messages, "count": len(messages)},
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
        }
    )

@app.post("/api/conversations/{phone}/reply")
async def send_reply(phone: str, req: ReplyRequest):
    clean_phone = extract_phone_number(phone)
    text_content = (req.text or "").strip()
    media_url = (req.media_url or "").strip() if req.media_url else None

    if not text_content and not media_url:
        return JSONResponse(status_code=400, content={"error": "Message text or media attachment is required."})

    result = send_whatsapp_message(
        to_phone=clean_phone,
        text=text_content if text_content else None,
        media_url=media_url,
        public_id=current_settings.get("public_id"),
        secret_key=current_settings.get("secret_key"),
        channel_id=current_settings.get("channel_id")
    )

    status_str = result.get("status", "SENT")
    msg_id = result.get("message_id")
    error_str = result.get("error")

    saved_doc = storage.save_outbound_message(
        phone=clean_phone,
        text=text_content,
        media_url=media_url,
        message_id=msg_id,
        status=status_str,
        error=error_str
    )

    outbound_payload = {
        "type": "outbound_message",
        "phone": clean_phone,
        "content": text_content or f"[Media: {media_url}]",
        "media_url": media_url,
        "status": status_str
    }
    try:
        asyncio.create_task(broadcaster.broadcast(outbound_payload))
    except Exception as be:
        logger.debug(f"Broadcast error: {be}")
    publish_event(outbound_payload)

    return {
        "success": result.get("success", False),
        "status": status_str,
        "message_id": msg_id,
        "error": error_str,
        "saved_message": saved_doc
    }

@app.post("/api/conversations/start")
async def start_conversation(req: StartChatRequest):
    clean_phone = extract_phone_number(req.phone)
    if not clean_phone:
        return JSONResponse(status_code=400, content={"error": "Invalid phone number."})

    text_content = (req.initial_message or "").strip()
    media_url = (req.media_url or "").strip() if req.media_url else None

    saved_doc = None
    if text_content or media_url:
        result = send_whatsapp_message(
            to_phone=clean_phone,
            text=text_content if text_content else None,
            media_url=media_url,
            public_id=current_settings.get("public_id"),
            secret_key=current_settings.get("secret_key"),
            channel_id=current_settings.get("channel_id")
        )
        saved_doc = storage.save_outbound_message(
            phone=clean_phone,
            text=text_content,
            media_url=media_url,
            message_id=result.get("message_id"),
            status=result.get("status", "SENT"),
            error=result.get("error")
        )

    try:
        asyncio.create_task(broadcaster.broadcast({
            "type": "chat_started",
            "phone": clean_phone
        }))
    except Exception as be:
        logger.debug(f"Broadcast error: {be}")

    return {"status": "ok", "phone": clean_phone, "message": saved_doc}

# --- Media Upload & Asset Management Endpoints ---

@app.post("/api/upload")
async def upload_media_file(request: Request, file: UploadFile = File(...)):
    """
    Uploads a media asset (image/video/document) directly to the VPS storage
    and generates an instant public HTTPS direct link (e.g. https://whatsapp.rush.com.sa/uploads/...).
    """
    if not file or not file.filename:
        return JSONResponse(status_code=400, content={"error": "No file uploaded."})

    # Sanitize filename
    orig_name = Path(file.filename).name
    stem = re.sub(r'[^a-zA-Z0-9_\-]', '_', Path(orig_name).stem)[:40]
    ext = Path(orig_name).suffix.lower()
    if not ext:
        ext = ".jpg"

    unique_filename = f"media_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{stem}_{uuid.uuid4().hex[:6]}{ext}"
    target_path = UPLOADS_DIR / unique_filename

    total_bytes = 0
    try:
        with open(target_path, "wb") as f:
            while chunk := await file.read(1024 * 1024):
                f.write(chunk)
                total_bytes += len(chunk)
    except Exception as e:
        logger.error(f"Error saving uploaded file {unique_filename}: {e}")
        return JSONResponse(status_code=500, content={"error": f"Failed to save file on VPS: {str(e)}"})

    # Determine public URL
    public_base = "https://whatsapp.rush.com.sa"
    host_header = request.headers.get("host")
    if host_header:
        proto = request.headers.get("x-forwarded-proto", "https")
        public_base = f"{proto}://{host_header}"

    public_url = f"{public_base}/uploads/{unique_filename}"
    size_formatted = f"{total_bytes / (1024*1024):.2f} MB" if total_bytes > 1024*1024 else f"{total_bytes / 1024:.1f} KB"

    logger.info(f"Media uploaded to VPS: {unique_filename} ({size_formatted}) -> {public_url}")

    return {
        "success": True,
        "url": public_url,
        "filename": unique_filename,
        "original_name": orig_name,
        "size_bytes": total_bytes,
        "size_formatted": size_formatted,
        "content_type": file.content_type or "application/octet-stream"
    }

@app.get("/api/uploads")
async def list_uploaded_media(request: Request):
    """Lists all media files hosted on the VPS uploads directory."""
    files = []
    public_base = "https://whatsapp.rush.com.sa"
    host_header = request.headers.get("host")
    if host_header:
        proto = request.headers.get("x-forwarded-proto", "https")
        public_base = f"{proto}://{host_header}"

    if UPLOADS_DIR.exists():
        for p in sorted(UPLOADS_DIR.glob("*"), key=os.path.getmtime, reverse=True):
            if p.is_file():
                size = p.stat().st_size
                mtime = datetime.fromtimestamp(p.stat().st_mtime, tz=timezone.utc).isoformat()
                files.append({
                    "filename": p.name,
                    "url": f"{public_base}/uploads/{p.name}",
                    "size_formatted": f"{size / (1024*1024):.2f} MB" if size > 1024*1024 else f"{size / 1024:.1f} KB",
                    "created_at": mtime
                })

    return {"count": len(files), "uploads": files[:100]}

@app.delete("/api/uploads/{filename}")
async def delete_uploaded_media(filename: str):
    """Deletes an uploaded media file from the VPS storage."""
    safe_name = Path(filename).name
    target = UPLOADS_DIR / safe_name
    if target.exists() and target.is_file():
        try:
            target.unlink()
            return {"success": True, "message": f"Deleted {safe_name}"}
        except Exception as e:
            return JSONResponse(status_code=500, content={"error": str(e)})
    return JSONResponse(status_code=404, content={"error": "File not found."})


# --- Delivery Reports & Analytics API Endpoints ---

@app.get("/api/reports")
async def get_delivery_reports(
    status: Optional[str] = Query(None, description="Filter by status: ALL, SENT, DELIVERED, READ, FAILED"),
    phone: Optional[str] = Query(None, description="Filter by phone number"),
    date_from: Optional[str] = Query(None, description="Start date YYYY-MM-DD"),
    date_to: Optional[str] = Query(None, description="End date YYYY-MM-DD"),
    traffic_type: str = Query("campaign", description="Traffic scope: 'campaign' (default), 'all', 'support'"),
    limit: int = 500
):
    rate = float(current_settings.get("cost_marketing", DEFAULT_COST_MARKETING))
    curr = str(current_settings.get("currency", DEFAULT_CURRENCY))

    reports = storage.get_delivery_reports(
        status_filter=status,
        phone_filter=phone,
        date_from=date_from,
        date_to=date_to,
        cost_per_msg=rate,
        currency=curr,
        traffic_type=traffic_type,
        limit=limit
    )
    kpis = storage.get_delivery_kpis(
        date_from=date_from,
        date_to=date_to,
        cost_per_msg=rate,
        currency=curr,
        traffic_type=traffic_type
    )
    return {
        "kpis": kpis,
        "reports": reports,
        "count": len(reports),
        "cost_rate": rate,
        "currency": curr
    }

@app.get("/api/reports/export")
async def export_reports_csv(
    status: Optional[str] = Query(None),
    phone: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    traffic_type: str = Query("campaign", description="Traffic scope: 'campaign' (default), 'all', 'support'")
):
    rate = float(current_settings.get("cost_marketing", DEFAULT_COST_MARKETING))
    curr = str(current_settings.get("currency", DEFAULT_CURRENCY))

    reports = storage.get_delivery_reports(
        status_filter=status,
        phone_filter=phone,
        date_from=date_from,
        date_to=date_to,
        cost_per_msg=rate,
        currency=curr,
        traffic_type=traffic_type,
        limit=50000
    )
    output = io.StringIO()
    output.write("\ufeff")  # UTF-8 BOM
    writer = csv.writer(output)
    writer.writerow(["Message ID", "Recipient", f"Cost ({curr})", "Status", "Sent At", "Delivered At", "Read At", "Error Reason", "Message Preview"])
    for r in reports:
        writer.writerow([
            r.get("message_id"),
            r.get("recipient"),
            f"{r.get('cost', rate):.3f}",
            r.get("status"),
            r.get("sent_at", ""),
            r.get("delivered_at", ""),
            r.get("read_at", ""),
            r.get("error", ""),
            r.get("content", "")
        ])
    output.seek(0)
    filename = f"whatsapp_delivery_reports_{traffic_type}_{date_from or 'all'}_{date_to or 'all'}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

# --- Analytics & Template Endpoints ---

@app.get("/api/analytics")
async def get_analytics_overview(
    date_from: Optional[str] = Query(None, description="Start date YYYY-MM-DD"),
    date_to: Optional[str] = Query(None, description="End date YYYY-MM-DD"),
    traffic_type: str = Query("campaign", description="Traffic scope: 'campaign' (default), 'all', 'support'")
):
    convs = storage.get_conversations()
    rate = float(current_settings.get("cost_marketing", DEFAULT_COST_MARKETING))
    curr = str(current_settings.get("currency", DEFAULT_CURRENCY))

    kpis = storage.get_delivery_kpis(
        date_from=date_from,
        date_to=date_to,
        cost_per_msg=rate,
        currency=curr,
        traffic_type=traffic_type
    )
    
    total_sent = kpis.get("sent", 0)
    delivered_count = kpis.get("delivered", 0)
    read_count = kpis.get("read", 0)
    failed_count = kpis.get("failed", 0)
    total_inbound = kpis.get("messages_received", 0)
    total_cost = kpis.get("total_cost", round(delivered_count * rate, 2))
    delivery_rate = kpis.get("delivery_rate", 0.0)
    
    # Calculate active 24h care window
    active_24h = 0
    now = datetime.now(timezone.utc)
    for c in convs:
        ts = c.get("last_timestamp")
        if ts:
            try:
                dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                if (now - dt).total_seconds() < 24 * 3600:
                    active_24h += 1
            except Exception:
                pass
                
    return {
        "total_sent": total_sent,
        "total_delivered": delivered_count,
        "total_inbound": total_inbound or len(convs),
        "read_count": read_count,
        "delivered_count": delivered_count,
        "failed_count": failed_count,
        "delivery_rate": delivery_rate,
        "active_24h_sessions": active_24h if active_24h > 0 else len(convs),
        "total_cost": total_cost,
        "total_spent": total_cost,
        "cost_per_message": rate,
        "currency": curr,
        "traffic_type": traffic_type,
        "service_quota": kpis.get("service_quota"),
        "kpis": kpis
    }

def _format_template_item(t: dict, format_type: str = "full") -> dict:
    components = t.get("components") or []
    body_text = ""
    header = None
    buttons = []
    variables = []

    for comp in components:
        ctype = str(comp.get("type", "")).upper()
        if ctype == "BODY":
            body_text = comp.get("text", "")
            variables = re.findall(r"\{\{?(\d+)\}?\}", body_text)
        elif ctype == "HEADER":
            header = {
                "format": comp.get("format"),
                "text": comp.get("text"),
                "example": comp.get("example")
            }
        elif ctype == "BUTTONS":
            buttons = comp.get("buttons", [])

    vars_sorted = sorted(list(set(variables)), key=lambda x: int(x) if x.isdigit() else str(x))

    if format_type == "summary":
        item = {
            "id": t.get("id"),
            "name": t.get("name"),
            "status": t.get("status"),
            "category": t.get("category"),
            "language": t.get("language"),
            "body_text": body_text,
            "variables": vars_sorted,
            "buttons_count": len(buttons)
        }
        if header:
            item["header_format"] = header.get("format")
        return item

    # Full representation: preserve original template fields and augment with helper fields
    res = dict(t)
    res.update({
        "body_text": body_text,
        "variables": vars_sorted,
        "header": header,
        "buttons": buttons
    })
    return res

@app.get("/api/templates/approved")
async def list_approved_templates(
    category: Optional[str] = Query(None, description="Filter by category (e.g. MARKETING, UTILITY, AUTHENTICATION)"),
    language: Optional[str] = Query(None, description="Filter by language code (e.g. ar, en)"),
    search: Optional[str] = Query(None, description="Search keyword in template name or body text"),
    format: Optional[str] = Query("full", description="Response format: 'full' (with components) or 'summary'"),
    refresh: bool = Query(False, description="Force live refresh from Unifonic API")
):
    """
    Public / external API returning all pre-approved WhatsApp message templates.
    Accessible by external applications, services, and dashboards without requiring a session cookie.
    """
    templates = get_whatsapp_templates(
        public_id=current_settings.get("public_id"),
        secret_key=current_settings.get("secret_key")
    )
    
    # Strictly filter for APPROVED
    approved = [t for t in templates if str(t.get("status", "")).strip().upper() == "APPROVED"]
    
    if category:
        cat_clean = category.strip().upper()
        approved = [t for t in approved if str(t.get("category", "")).strip().upper() == cat_clean]
        
    if language:
        lang_clean = language.strip().lower()
        approved = [t for t in approved if str(t.get("language", "")).strip().lower() == lang_clean]
        
    formatted = [_format_template_item(t, format_type=format) for t in approved]
    
    if search:
        kw = search.strip().lower()
        formatted = [
            t for t in formatted
            if kw in (t.get("name") or "").lower() or kw in (t.get("body_text") or "").lower()
        ]
        
    return {
        "status": "success",
        "filter": {
            "status": "APPROVED",
            "category": category.upper() if category else None,
            "language": language.lower() if language else None,
            "search": search or None
        },
        "count": len(formatted),
        "templates": formatted
    }

@app.get("/api/templates")
async def list_templates(
    status: Optional[str] = Query(None, description="Filter by status (e.g. APPROVED, IN_REVIEW, REJECTED)"),
    category: Optional[str] = Query(None, description="Filter by category (e.g. MARKETING, UTILITY, AUTHENTICATION)"),
    language: Optional[str] = Query(None, description="Filter by language code (e.g. ar, en)"),
    format: Optional[str] = Query("full", description="Response format: 'full' or 'summary'"),
    refresh: bool = Query(False, description="Force live refresh from Unifonic API")
):
    templates = get_whatsapp_templates(
        public_id=current_settings.get("public_id"),
        secret_key=current_settings.get("secret_key")
    )
    
    if status:
        st_clean = status.strip().upper()
        templates = [t for t in templates if str(t.get("status", "")).strip().upper() == st_clean]
        
    if category:
        cat_clean = category.strip().upper()
        templates = [t for t in templates if str(t.get("category", "")).strip().upper() == cat_clean]
        
    if language:
        lang_clean = language.strip().lower()
        templates = [t for t in templates if str(t.get("language", "")).strip().lower() == lang_clean]

    if format == "summary":
        templates = [_format_template_item(t, format_type="summary") for t in templates]
    else:
        templates = [_format_template_item(t, format_type="full") for t in templates]

    return {"count": len(templates), "templates": templates}

@app.post("/api/templates")
async def create_template_endpoint(req: CreateTemplateRequest):
    """
    Creates a new WhatsApp message template via Meta Graph API / local registry
    and makes it instantly available for Broadcasts, Live Chat, and Phone Simulation.
    """
    if not req.name or not req.name.strip():
        return JSONResponse(status_code=400, content={"error": "Template name is required."})
    if not req.body or not req.body.strip():
        return JSONResponse(status_code=400, content={"error": "Template body is required."})

    result = create_whatsapp_template_api(
        name=req.name.strip(),
        body=req.body.strip(),
        category=req.category or "MARKETING",
        language=req.language or "ar",
        status=req.status or "IN_REVIEW",
        media_url=req.media_url,
        buttons=req.buttons,
        meta_waba_id=req.meta_waba_id,
        meta_access_token=req.meta_access_token,
        public_id=current_settings.get("public_id"),
        secret_key=current_settings.get("secret_key")
    )
    return result

@app.get("/api/templates/{name}/csv")
async def download_template_csv_endpoint(name: str):
    """
    Generates a pre-formatted CSV template tailored with the dynamic variable headers
    for a specific template (e.g. phone, 1, 2 or phone, code).
    """
    templates = get_whatsapp_templates(
        public_id=current_settings.get("public_id"),
        secret_key=current_settings.get("secret_key")
    )
    match = next((t for t in templates if (t.get("name") or "").lower() == name.lower()), None)
    
    body_text = ""
    if match:
        comps = match.get("components") or []
        for c in comps:
            if isinstance(c, dict) and c.get("type", "").upper() == "BODY":
                body_text = c.get("text", "")
                break
    
    vars_found = []
    if body_text:
        vars_found = list(dict.fromkeys(re.findall(r"\{\{([a-zA-Z0-9_]+)\}\}", body_text)))
    
    headers = ["phone"] + (vars_found if vars_found else [])
    sample_rows = [
        ["966569809578"] + (["FIRSTWASH-101" if v == "1" else f"sample_{v}" for v in vars_found]),
        ["966553337736"] + (["FIRSTWASH-102" if v == "1" else f"sample_{v}" for v in vars_found]),
        ["966501234567"] + (["FIRSTWASH-103" if v == "1" else f"sample_{v}" for v in vars_found])
    ]
    
    output = io.StringIO()
    output.write("\ufeff")  # UTF-8 BOM
    writer = csv.writer(output)
    writer.writerow(headers)
    for row in sample_rows:
        writer.writerow(row)
        
    output.seek(0)
    filename = f"rush_template_{name}_variables.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@app.post("/api/templates/{name}/status")
@app.patch("/api/templates/{name}/status")
async def update_template_status_endpoint(name: str, req: UpdateTemplateStatusRequest):
    """
    Updates the status (e.g. APPROVED, IN_REVIEW, PENDING, REJECTED) of a template in the local registry.
    """
    from unifonic_app.unifonic_client import update_template_status
    if not req.status or not req.status.strip():
        return JSONResponse(status_code=400, content={"error": "Status is required."})
    result = update_template_status(name=name, new_status=req.status)
    return result

@app.get("/api/campaigns")
async def list_campaigns():
    return campaign_manager.list_campaigns()

@app.post("/api/campaigns")
async def create_campaign(req: CreateCampaignRequest):
    cid = campaign_manager.create_campaign(
        name=req.name,
        recipients=req.recipients,
        message_template=req.message_template,
        media_url=req.media_url,
        template_name=req.template_name,
        template_language=req.template_language or "ar",
        delay_seconds=req.delay_seconds or 0.1
    )
    asyncio.create_task(campaign_manager.run_campaign_task(cid))
    return {"success": True, "campaign_id": cid}

@app.get("/api/campaigns/{campaign_id}")
async def get_campaign(campaign_id: str):
    c = campaign_manager.get_campaign(campaign_id)
    if not c:
        return JSONResponse(status_code=404, content={"error": "Campaign not found"})
    return c

@app.post("/api/campaigns/{campaign_id}/stop")
async def stop_campaign(campaign_id: str):
    ok = campaign_manager.stop_campaign(campaign_id)
    return {"success": ok}

@app.get("/api/settings")
async def get_settings():
    pid = current_settings.get("public_id") or ""
    sec = current_settings.get("secret_key") or ""
    cid = current_settings.get("channel_id") or ""
    return {
        "public_id": pid,
        "is_secret_set": bool(sec),
        "channel_id": cid,
        "cost_marketing": current_settings.get("cost_marketing", DEFAULT_COST_MARKETING),
        "cost_utility": current_settings.get("cost_utility", DEFAULT_COST_UTILITY),
        "cost_auth": current_settings.get("cost_auth", DEFAULT_COST_AUTH),
        "cost_service": current_settings.get("cost_service", DEFAULT_COST_SERVICE),
        "currency": current_settings.get("currency", DEFAULT_CURRENCY),
        "https_webhook_url": PUBLIC_HTTPS_URL,
        "database": _database_label(),
        "database_stats": _database_stats(),
        "mongo_connected": False
    }

@app.post("/api/settings")
async def update_settings(req: SettingsRequest):
    if req.public_id is not None:
        current_settings["public_id"] = req.public_id.strip()
    if req.secret_key is not None:
        current_settings["secret_key"] = req.secret_key.strip()
    if req.channel_id is not None:
        current_settings["channel_id"] = req.channel_id.strip()
    if req.cost_marketing is not None:
        current_settings["cost_marketing"] = float(req.cost_marketing)
    if req.cost_utility is not None:
        current_settings["cost_utility"] = float(req.cost_utility)
    if req.cost_auth is not None:
        current_settings["cost_auth"] = float(req.cost_auth)
    if req.cost_service is not None:
        current_settings["cost_service"] = float(req.cost_service)
    if req.currency is not None:
        current_settings["currency"] = req.currency.strip().upper()

    # Also persist to local .env
    try:
        env_file = APP_DIR / ".env"
        lines = []
        if env_file.exists():
            with open(env_file, "r", encoding="utf-8") as f:
                lines = f.readlines()
        
        updated_pub = False
        updated_sec = False
        updated_cid = False
        updated_cm = False
        updated_cu = False
        updated_ca = False
        updated_cs = False
        updated_curr = False
        new_lines = []
        for l in lines:
            if l.startswith("UNIFONIC_PUBLIC_ID="):
                new_lines.append(f"UNIFONIC_PUBLIC_ID={current_settings['public_id']}\n")
                updated_pub = True
            elif l.startswith("UNIFONIC_SECRET_KEY="):
                new_lines.append(f"UNIFONIC_SECRET_KEY={current_settings['secret_key']}\n")
                updated_sec = True
            elif l.startswith("UNIFONIC_CHANNEL_ID="):
                new_lines.append(f"UNIFONIC_CHANNEL_ID={current_settings.get('channel_id', '')}\n")
                updated_cid = True
            elif l.startswith("UNIFONIC_COST_MARKETING="):
                new_lines.append(f"UNIFONIC_COST_MARKETING={current_settings.get('cost_marketing', DEFAULT_COST_MARKETING)}\n")
                updated_cm = True
            elif l.startswith("UNIFONIC_COST_UTILITY="):
                new_lines.append(f"UNIFONIC_COST_UTILITY={current_settings.get('cost_utility', DEFAULT_COST_UTILITY)}\n")
                updated_cu = True
            elif l.startswith("UNIFONIC_COST_AUTH="):
                new_lines.append(f"UNIFONIC_COST_AUTH={current_settings.get('cost_auth', DEFAULT_COST_AUTH)}\n")
                updated_ca = True
            elif l.startswith("UNIFONIC_COST_SERVICE="):
                new_lines.append(f"UNIFONIC_COST_SERVICE={current_settings.get('cost_service', DEFAULT_COST_SERVICE)}\n")
                updated_cs = True
            elif l.startswith("UNIFONIC_CURRENCY="):
                new_lines.append(f"UNIFONIC_CURRENCY={current_settings.get('currency', DEFAULT_CURRENCY)}\n")
                updated_curr = True
            else:
                new_lines.append(l)
        
        if not updated_pub and current_settings.get("public_id"):
            new_lines.append(f"UNIFONIC_PUBLIC_ID={current_settings['public_id']}\n")
        if not updated_sec and current_settings.get("secret_key"):
            new_lines.append(f"UNIFONIC_SECRET_KEY={current_settings['secret_key']}\n")
        if not updated_cid and current_settings.get("channel_id"):
            new_lines.append(f"UNIFONIC_CHANNEL_ID={current_settings['channel_id']}\n")
        if not updated_cm:
            new_lines.append(f"UNIFONIC_COST_MARKETING={current_settings.get('cost_marketing', DEFAULT_COST_MARKETING)}\n")
        if not updated_cu:
            new_lines.append(f"UNIFONIC_COST_UTILITY={current_settings.get('cost_utility', DEFAULT_COST_UTILITY)}\n")
        if not updated_ca:
            new_lines.append(f"UNIFONIC_COST_AUTH={current_settings.get('cost_auth', DEFAULT_COST_AUTH)}\n")
        if not updated_cs:
            new_lines.append(f"UNIFONIC_COST_SERVICE={current_settings.get('cost_service', DEFAULT_COST_SERVICE)}\n")
        if not updated_curr:
            new_lines.append(f"UNIFONIC_CURRENCY={current_settings.get('currency', DEFAULT_CURRENCY)}\n")

        with open(env_file, "w", encoding="utf-8") as f:
            f.writelines(new_lines)
    except Exception as e:
        logger.warning(f"Could not persist settings to .env: {e}")

    return {"status": "success", "message": "Settings and pricing rates updated and persisted.", "settings": current_settings}

@app.get("/api/events")
async def list_raw_events(limit: int = 50):
    events = storage.get_recent_events(limit=limit)
    return {"count": len(events), "events": events}

# --- Live GET Sync with Unifonic ---

@app.get("/api/unifonic/status/{message_id}")
async def get_single_unifonic_status(message_id: str):
    """Directly queries Unifonic via GET for a specific message status."""
    results = get_messages_status(
        message_ids=[message_id],
        public_id=current_settings.get("public_id"),
        secret_key=current_settings.get("secret_key")
    )
    if results:
        storage.update_unifonic_statuses(results)
        return {"success": True, "message_id": message_id, "data": results[0]}
    return JSONResponse(status_code=404, content={"success": False, "error": "Message ID not found on Unifonic."})

@app.post("/api/unifonic/sync")
async def sync_all_unifonic_statuses():
    """Queries Unifonic via GET for all known message IDs and updates local statuses."""
    mids = storage.get_all_message_ids(limit=200)
    if not mids:
        return {"success": True, "queried_count": 0, "message": "No outbound message IDs to sync."}

    results = await asyncio.to_thread(
        get_messages_status,
        message_ids=mids,
        public_id=current_settings.get("public_id"),
        secret_key=current_settings.get("secret_key")
    )

    updated_count = storage.update_unifonic_statuses(results)
    return {
        "success": True,
        "queried_count": len(mids),
        "results_received": len(results),
        "updated_records": updated_count,
        "data": results
    }

@app.post("/api/unifonic/recover-inbound")
async def recover_missed_inbound(
    max_conversations: int = Query(50, description="How many recent conversations to scan (max 100)"),
    messages_per_conversation: int = Query(20, description="How many messages to fetch per conversation")
):
    """
    Recovers inbound WhatsApp messages that were missed while the webhook was offline.

    Polls Unifonic's Conversations API, pulls the most recent inbound messages
    from each conversation thread, deduplicates against already-stored message IDs,
    and saves only the genuinely new ones to local storage.
    """
    max_conversations = min(max_conversations, 100)
    messages_per_conversation = min(messages_per_conversation, 100)

    raw_messages = fetch_missed_inbound_messages(
        public_id=current_settings.get("public_id"),
        secret_key=current_settings.get("secret_key"),
        channel_id=current_settings.get("channel_id"),
        max_conversations=max_conversations,
        messages_per_conversation=messages_per_conversation,
    )

    if not raw_messages:
        return {
            "success": True,
            "fetched": 0,
            "new_saved": 0,
            "skipped_duplicates": 0,
            "message": "No inbound messages returned from Unifonic. "
                       "This may mean no conversations exist yet, or credentials are incorrect."
        }

    # Collect known message IDs so we can skip duplicates
    known_ids: set = set(storage.get_all_message_ids(limit=2000))

    saved = []
    skipped = 0

    for msg in raw_messages:
        # Normalize the raw Unifonic message dict into a NormalizedWhatsAppEvent
        # Field names vary across API versions — try the most common keys.
        msg_id = str(
            msg.get("id") or msg.get("messageId") or msg.get("message_id") or ""
        ).strip()

        # Skip if we already have this message stored
        if msg_id and msg_id in known_ids:
            skipped += 1
            continue

        sender_raw = (
            msg.get("sender")
            or msg.get("from")
            or msg.get("senderId")
            or msg.get("contact")
            or (msg.get("recipient", {}) or {}).get("contact")
        )
        content_raw = None
        body = msg.get("content") or msg.get("message") or msg.get("text")
        if isinstance(body, dict):
            content_raw = body.get("text") or body.get("body")
        elif isinstance(body, str):
            content_raw = body

        # Build a synthetic webhook-style payload and let parse_unifonic_event handle it
        synthetic_payload = {
            "eventType": "message.received",
            "messageId": msg_id or None,
            "from": sender_raw,
            "content": {"text": content_raw} if content_raw else {},
            "createdAt": msg.get("createdAt") or msg.get("created_at") or msg.get("timestamp"),
            "_source": "recover_inbound_api",
            "_raw": msg,
        }

        event = parse_unifonic_event(synthetic_payload)
        # Override received_at if Unifonic gives us the real timestamp
        real_ts = msg.get("createdAt") or msg.get("created_at") or msg.get("timestamp")
        if real_ts:
            event.received_at = str(real_ts)

        save_result = storage.save_event(event)
        saved.append({
            "message_id": msg_id or event.message_id,
            "sender": event.sender,
            "content_preview": (content_raw or "")[:80],
            "saved_to_mongo": bool(save_result.get("mongo_id")),
        })

        # Track so subsequent iterations don't re-add the same ID
        if msg_id:
            known_ids.add(msg_id)

    logger.info(
        f"[RecoverInbound] Done — fetched={len(raw_messages)}, "
        f"new_saved={len(saved)}, skipped_duplicates={skipped}"
    )

    return {
        "success": True,
        "fetched": len(raw_messages),
        "new_saved": len(saved),
        "skipped_duplicates": skipped,
        "saved_messages": saved,
    }


# ==========================================
# SNAPCHAT & META ADS INTEGRATION ENDPOINTS
# ==========================================

@app.get("/api/ads/performance")
async def get_ads_performance(request: Request):
    """Returns blended ROI, platform breakdowns, and campaigns for Meta & Snap."""
    all_events = storage.get_events()
    return ads_service.get_performance_summary(real_inbound_events=all_events)

@app.post("/api/ads/sync")
async def sync_ads_performance(request: Request):
    """Triggers live ingestion from Meta & Snapchat Marketing APIs."""
    result = ads_service.sync_ads_metrics()
    return {"success": True, "message": "Ads metrics refreshed successfully", "data": result}

@app.get("/api/ads/settings")
async def get_ads_settings(request: Request):
    """Returns Meta & Snap configuration status and credentials (masked)."""
    cfg = dict(ads_service.config)
    # Mask tokens for UI display
    meta_tok = cfg.get("meta", {}).get("access_token", "")
    snap_tok = cfg.get("snapchat", {}).get("refresh_token", "")
    return {
        "meta": {
            "enabled": cfg.get("meta", {}).get("enabled", True),
            "ad_account_id": cfg.get("meta", {}).get("ad_account_id", ""),
            "has_token": bool(meta_tok),
            "masked_token": (meta_tok[:8] + "..." + meta_tok[-4:]) if len(meta_tok) > 12 else ("Set" if meta_tok else "Not set"),
            "status": cfg.get("meta", {}).get("status", "demo_mode")
        },
        "snapchat": {
            "enabled": cfg.get("snapchat", {}).get("enabled", True),
            "ad_account_id": cfg.get("snapchat", {}).get("ad_account_id", ""),
            "client_id": cfg.get("snapchat", {}).get("client_id", ""),
            "has_token": bool(snap_tok),
            "masked_token": (snap_tok[:8] + "..." + snap_tok[-4:]) if len(snap_tok) > 12 else ("Set" if snap_tok else "Not set"),
            "status": cfg.get("snapchat", {}).get("status", "demo_mode")
        },
        "whatsapp_business_phone": cfg.get("whatsapp_business_phone", "966559421442"),
        "last_synced_at": cfg.get("last_synced_at")
    }

@app.post("/api/ads/settings")
async def update_ads_settings(request: Request):
    """Updates Meta & Snap Ads API credentials."""
    try:
        data = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    cfg = ads_service.config
    if "meta" in data:
        meta_in = data["meta"]
        if "ad_account_id" in meta_in:
            cfg["meta"]["ad_account_id"] = meta_in["ad_account_id"]
        if meta_in.get("access_token") and not meta_in["access_token"].startswith("...") and meta_in["access_token"] != "Not set":
            cfg["meta"]["access_token"] = meta_in["access_token"]
            cfg["meta"]["status"] = "connected"
        if "enabled" in meta_in:
            cfg["meta"]["enabled"] = bool(meta_in["enabled"])

    if "snapchat" in data:
        snap_in = data["snapchat"]
        if "ad_account_id" in snap_in:
            cfg["snapchat"]["ad_account_id"] = snap_in["ad_account_id"]
        if "client_id" in snap_in:
            cfg["snapchat"]["client_id"] = snap_in["client_id"]
        if "client_secret" in snap_in and snap_in["client_secret"]:
            cfg["snapchat"]["client_secret"] = snap_in["client_secret"]
        if snap_in.get("refresh_token") and not snap_in["refresh_token"].startswith("...") and snap_in["refresh_token"] != "Not set":
            cfg["snapchat"]["refresh_token"] = snap_in["refresh_token"]
            cfg["snapchat"]["status"] = "connected"
        if "enabled" in snap_in:
            cfg["snapchat"]["enabled"] = bool(snap_in["enabled"])

    if "whatsapp_business_phone" in data:
        cfg["whatsapp_business_phone"] = data["whatsapp_business_phone"]

    ads_service.save_config(cfg)
    return {"success": True, "message": "Ads configuration updated successfully"}

@app.post("/api/ads/tracking-link")
async def generate_ads_tracking_link(request: Request):
    """Generates Click-to-WhatsApp link with keyword attribution for Snap & Meta ads."""
    try:
        data = await request.json()
    except Exception:
        data = {}
    platform = data.get("platform", "snapchat")
    keyword = data.get("keyword", "PROMO")
    custom_text = data.get("custom_text", "")
    url = ads_service.generate_tracking_url(platform, keyword, custom_text)
    return {"success": True, "url": url, "platform": platform, "keyword": keyword}


@app.get("/api/ads/snap/auth-url")
async def get_snapchat_auth_url(request: Request, redirect_uri: str = "https://whatsapp.rush.com.sa/"):
    """Returns the 1-click Snapchat OAuth authorization URL."""
    url = ads_service.get_snapchat_oauth_url(redirect_uri)
    return {"success": True, "auth_url": url}

@app.post("/api/ads/snap/exchange-code")
async def exchange_snapchat_code(request: Request):
    """Exchanges authorization code for Snapchat tokens and discovers Ad Account."""
    try:
        data = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)
    
    code = data.get("code")
    redirect_uri = data.get("redirect_uri", "https://whatsapp.rush.com.sa/")
    if not code:
        return JSONResponse({"error": "Missing code parameter"}, status_code=400)
    
    res = ads_service.exchange_snapchat_code(code, redirect_uri)
    return res


# ==========================================
# SMART TRACKING LINK REDIRECT & ANALYTICS
# ==========================================

@app.get("/r/{slug}")
async def redirect_tracking_link(slug: str, request: Request):
    """
    Sub-15ms fast 302 redirect to rush.com.sa (or custom landing page).
    Asynchronously records click metadata, visitor hash, device brand & model, OS version, carrier, and referrer.
    """
    destination = link_tracker.get_destination(slug)
    if not destination:
        # Fallback to homepage if slug not found
        destination = "https://rush.com.sa/en"

    # Extract client metadata
    client_ip = (
        request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        or request.headers.get("x-real-ip")
        or request.client.host
        if request.client else "unknown"
    )
    user_agent = request.headers.get("user-agent", "")
    referrer = request.headers.get("referer", "") or request.headers.get("referrer", "")
    query_params = dict(request.query_params)
    headers_dict = dict(request.headers)

    # Record click asynchronously in background (zero user latency)
    try:
        asyncio.create_task(asyncio.to_thread(
            link_tracker.record_click,
            slug,
            client_ip,
            user_agent,
            referrer,
            query_params,
            headers_dict
        ))
    except Exception as e:
        logger.warning(f"Error dispatching click tracking task: {e}")

    # Return immediate 302 redirect with modern Client Hints request headers
    response = RedirectResponse(url=destination, status_code=302)
    response.headers["Accept-CH"] = "Sec-CH-UA, Sec-CH-UA-Mobile, Sec-CH-UA-Platform, Sec-CH-UA-Platform-Version, Sec-CH-UA-Model, Sec-CH-Prefers-Color-Scheme"
    response.headers["Permissions-Policy"] = "ch-ua-model=*, ch-ua-platform-version=*"
    return response


@app.get("/i/{slug}")
@app.get("/px/{slug}.gif")
async def impression_tracker_pixel(slug: str, request: Request):
    """
    Returns a 1x1 transparent GIF image for ad impression tracking (Snapchat, Meta, Newsletters, etc.).
    Asynchronously records impression metadata, visitor hash, device brand & model, OS version, carrier, and referrer.
    """
    client_ip = (
        request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        or request.headers.get("x-real-ip")
        or request.client.host
        if request.client else "unknown"
    )
    user_agent = request.headers.get("user-agent", "")
    referrer = request.headers.get("referer", "") or request.headers.get("referrer", "")
    query_params = dict(request.query_params)
    headers_dict = dict(request.headers)

    try:
        asyncio.create_task(asyncio.to_thread(
            link_tracker.record_impression,
            slug,
            client_ip,
            user_agent,
            referrer,
            query_params,
            headers_dict
        ))
    except Exception as e:
        logger.warning(f"Error logging impression task: {e}")

    return Response(
        content=TRANSPARENT_1X1_GIF,
        media_type="image/gif",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0"
        }
    )


@app.get("/api/links")
async def get_all_tracking_links(request: Request):
    """Returns list of all tracking links with click & impression counters."""
    return link_tracker.get_all_links_summary()


@app.post("/api/links")
async def create_tracking_link_endpoint(req: CreateLinkRequest):
    """Creates a new tracking link with automatic UTM builder."""
    if not req.title or not req.title.strip():
        return JSONResponse(status_code=400, content={"error": "Link title is required."})
    if not req.destination_url or not req.destination_url.strip():
        return JSONResponse(status_code=400, content={"error": "Destination URL is required."})

    created = link_tracker.create_or_update_link(
        title=req.title.strip(),
        destination_url=req.destination_url.strip(),
        slug=req.slug,
        platform=req.platform or "snapchat",
        utm_source=req.utm_source,
        utm_medium=req.utm_medium,
        utm_campaign=req.utm_campaign,
        utm_content=req.utm_content,
        utm_term=req.utm_term,
        status=req.status or "ACTIVE"
    )
    return {"success": True, "link": created}


@app.put("/api/links/{slug}")
async def update_tracking_link_endpoint(slug: str, req: UpdateLinkRequest):
    """Updates an existing tracking link."""
    if not req.title or not req.title.strip():
        return JSONResponse(status_code=400, content={"error": "Link title is required."})
    if not req.destination_url or not req.destination_url.strip():
        return JSONResponse(status_code=400, content={"error": "Destination URL is required."})

    try:
        updated = link_tracker.update_link(
            original_slug=slug,
            title=req.title.strip(),
            destination_url=req.destination_url.strip(),
            new_slug=req.slug,
            platform=req.platform or "snapchat",
            utm_source=req.utm_source,
            utm_medium=req.utm_medium,
            utm_campaign=req.utm_campaign,
            utm_content=req.utm_content,
            utm_term=req.utm_term,
            status=req.status or "ACTIVE"
        )
        return {"success": True, "link": updated}
    except KeyError:
        return JSONResponse(status_code=404, content={"error": f"Link '{slug}' not found."})
    except Exception as e:
        logger.error(f"Error updating link {slug}: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.post("/api/links/{slug}/toggle-status")
async def toggle_link_status_endpoint(slug: str, request: Request):
    """Toggles link status between ACTIVE and PAUSED."""
    updated = link_tracker.toggle_link_status(slug)
    if not updated:
        return JSONResponse(status_code=404, content={"error": "Link not found"})
    return {"success": True, "link": updated}


@app.get("/api/links/{slug}/stats")
async def get_link_detailed_stats(slug: str, request: Request):
    """Returns detailed demographic, device, OS, impressions, and click stream analytics for a link."""
    stats = link_tracker.get_link_analytics(slug)
    if "error" in stats:
        return JSONResponse(status_code=404, content=stats)
    return stats


@app.delete("/api/links/{slug}")
async def delete_tracking_link(slug: str, request: Request):
    """Deletes a tracking link."""
    success = link_tracker.delete_link(slug)
    if not success:
        return JSONResponse(status_code=404, content={"error": "Link not found"})
    return {"success": True, "message": f"Link '{slug}' deleted successfully"}


@app.get("/api/waves/status")
@app.get("/api/waves/status/{wave_name}")
@app.get("/api/campaigns/waves/status")
@app.get("/api/campaigns/waves/status/{wave_name}")
async def get_campaign_wave_status(wave_name: Optional[str] = None):
    """Returns real-time dispatch progress for campaign waves dynamically."""
    import glob
    import subprocess

    waves_info = {
        # Legacy/Static known waves
        "96sar_w1": {
            "name": "Wave 1 (300 Customers - Saturday Oct 10 03:30 PM AST)",
            "campaign": "96 SAR Promo",
            "script": "dispatch_96sar_wave1_300_saturday.py",
            "log": "send_list_96sar_wave1_300_today_dispatch_log.csv",
            "vps_log": "/opt/unifonic_app/campaigns/send_list_96sar_wave1_300_today_dispatch_log.csv",
            "target": 300
        },
        "96sar_w2": {
            "name": "Wave 2 (300 Customers - Sunday Oct 11 07:00 AM AST)",
            "campaign": "96 SAR Promo",
            "script": "dispatch_96sar_wave2_300_sunday.py",
            "log": "send_list_96sar_wave2_300_tomorrow_dispatch_log.csv",
            "vps_log": "/opt/unifonic_app/campaigns/send_list_96sar_wave2_300_tomorrow_dispatch_log.csv",
            "target": 300
        },
        "winback_200": {
            "name": "Winback 25% (200 Customers - Saturday Oct 10 05:00 PM AST)",
            "campaign": "Winback 25%",
            "script": "vps_dispatch_winback_200.py",
            "log": "send_list_winback_200_oct10_dispatch_log.csv",
            "vps_log": "/opt/unifonic_app/campaigns/send_list_winback_200_oct10_dispatch_log.csv",
            "target": 200
        },
        "96sar_w3": {
            "name": "Wave 3 (257 Customers - Monday Oct 12 07:00 AM AST)",
            "campaign": "96 SAR Promo",
            "script": "dispatch_96sar_wave3_257_monday.py",
            "log": "send_list_96sar_wave3_257_remaining_dispatch_log.csv",
            "vps_log": "/opt/unifonic_app/campaigns/send_list_96sar_wave3_257_remaining_dispatch_log.csv",
            "target": 257
        },
        "cmp26_w5": {
            "name": "Wave 5 (253 Customers - Saturday Oct 10 07:00 AM AST)",
            "campaign": "CMP-00026",
            "script": "dispatch_cmp00026_wave5_253_saturday.py",
            "log": "cmp_00026_wave5_253_saturday_dispatch_log.csv",
            "vps_log": "/opt/unifonic_app/campaigns/cmp_00026_wave5_253_saturday_dispatch_log.csv",
            "target": 253
        },
        "cmp26_w4": {
            "name": "Wave 4 (150 Customers - Friday Oct 09 11:00 AM AST)",
            "campaign": "CMP-00026",
            "script": "dispatch_cmp00026_wave4_150_friday.py",
            "log": "cmp_00026_wave4_150_friday_dispatch_log.csv",
            "vps_log": "/opt/unifonic_app/campaigns/cmp_00026_wave4_150_friday_dispatch_log.csv",
            "target": 150
        },
        "cmp26_w1": {
            "name": "Wave 1 (346 Customers - Sunday Oct 04 11:00 AM AST)",
            "campaign": "CMP-00026",
            "script": "dispatch_cmp00026_wave1_346_sunday.py",
            "log": "cmp_00026_wave1_346_sunday_dispatch_log.csv",
            "vps_log": "/opt/unifonic_app/campaigns/cmp_00026_wave1_346_sunday_dispatch_log.csv",
            "target": 346
        },
        "cmp26_w2": {
            "name": "Wave 2 (346 Customers - Monday Oct 05 11:00 AM AST)",
            "campaign": "CMP-00026",
            "script": "dispatch_cmp00026_wave2_346_monday.py",
            "log": "cmp_00026_wave2_346_monday_dispatch_log.csv",
            "vps_log": "/opt/unifonic_app/campaigns/cmp_00026_wave2_346_monday_dispatch_log.csv",
            "target": 346
        },
        "cmp26_w3": {
            "name": "Wave 3 (346 Customers - Tuesday Oct 06 11:00 AM AST)",
            "campaign": "CMP-00026",
            "script": "dispatch_cmp00026_wave3_346_tuesday.py",
            "log": "cmp_00026_wave3_346_tuesday_dispatch_log.csv",
            "vps_log": "/opt/unifonic_app/campaigns/cmp_00026_wave3_346_tuesday_dispatch_log.csv",
            "target": 346
        }
    }

    # Dynamically scan for dispatch scripts in /opt/unifonic_app/campaigns or local exports
    search_dirs = [Path("/opt/unifonic_app/campaigns"), APP_DIR.parent / "exports" / "campaign_batches"]
    for sdir in search_dirs:
        if sdir.exists():
            for script_p in sdir.rglob("dispatch_*.py"):
                sname = script_p.name
                # Parse format like dispatch_family_friends_200_20261011.py or dispatch_96_sar_300_20261011.py
                m = re.search(r"dispatch_([a-zA-Z0-9_]+?)_(\d+)_(\d{8})\.py", sname)
                if m:
                    camp_key, target_str, date_str = m.groups()
                    target_num = int(target_str)
                    camp_display = camp_key.replace("_", " ").title()
                    if "Sar" in camp_display:
                        camp_display = camp_display.replace("Sar", "SAR")
                    date_display = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:]}"
                    
                    wave_key = f"{camp_key}_{date_str}"
                    expected_csv_log = f"send_list_{camp_key}_{target_num}_{date_str}_dispatch_log.csv"
                    vps_log_p = Path("/opt/unifonic_app/campaigns") / expected_csv_log
                    
                    waves_info[wave_key] = {
                        "name": f"{camp_display} ({target_num} Recipients - {date_display})",
                        "campaign": camp_display,
                        "script": sname,
                        "log": expected_csv_log,
                        "vps_log": str(vps_log_p),
                        "target": target_num,
                        "date": date_display
                    }

    selected = {wave_name: waves_info[wave_name]} if wave_name and wave_name in waves_info else waves_info
    results = {}

    for k, info in selected.items():
        log_path = Path(info["vps_log"]) if Path(info["vps_log"]).exists() else (APP_DIR.parent / info["log"])
        sent_count = 0
        failed_count = 0
        last_sent_at = None
        is_completed = False

        if log_path.exists():
            try:
                with open(log_path, mode="r", encoding="utf-8-sig") as f:
                    reader = csv.DictReader(f)
                    for r in reader:
                        st = (r.get("Status") or r.get("status") or "").upper()
                        if st in ["SENT", "QUEUED", "DELIVERED", "READ"]:
                            sent_count += 1
                        elif st in ["FAILED", "ERROR"]:
                            failed_count += 1
                        last_sent_at = r.get("Timestamp") or r.get("timestamp")
                if sent_count + failed_count >= info["target"]:
                    is_completed = True
            except Exception:
                pass

        # Check if process is actively running right now
        is_running = False
        if os.name != 'nt' and info.get("script"):
            try:
                p_check = subprocess.run(["pgrep", "-f", info["script"]], capture_output=True, text=True)
                if p_check.stdout.strip():
                    is_running = True
            except Exception:
                pass

        results[k] = {
            "key": k,
            "name": info["name"],
            "campaign": info.get("campaign", "Campaign"),
            "script": info.get("script"),
            "target_recipients": info["target"],
            "sent_count": sent_count,
            "failed_count": failed_count,
            "completed": is_completed,
            "running": is_running,
            "last_sent_at": last_sent_at,
            "date": info.get("date")
        }

    return {"success": True, "campaign": "Active Campaigns", "waves": results}


@app.api_route("/api/waves/trigger/{wave_name}", methods=["GET", "POST"])
@app.api_route("/api/campaigns/waves/trigger/{wave_name}", methods=["GET", "POST"])
async def trigger_campaign_wave(wave_name: str, key: Optional[str] = Query(None)):
    """Triggers a campaign wave runner asynchronously via secure URL."""
    valid_keys = ["RushAdmin2026", "RushWash@2026", "rush2026"]
    if not key or key not in valid_keys:
        return JSONResponse(
            status_code=401,
            content={"success": False, "error": "Unauthorized. Please provide a valid ?key= parameter."}
        )

    wave_scripts = {
        "96sar_w1": "dispatch_96sar_wave1_300_saturday.py",
        "96sar_w2": "dispatch_96sar_wave2_300_sunday.py",
        "96sar_w3": "dispatch_96sar_wave3_257_monday.py",
        "winback_200": "vps_dispatch_winback_200.py",
        "cmp26_w5": "dispatch_cmp00026_wave5_253_saturday.py",
        "cmp26_w4": "dispatch_cmp00026_wave4_150_friday.py",
        "cmp26_w1": "dispatch_cmp00026_wave1_346_sunday.py",
        "cmp26_w2": "dispatch_cmp00026_wave2_346_monday.py",
        "cmp26_w3": "dispatch_cmp00026_wave3_346_tuesday.py",
        "wave1": "dispatch_wave1_200_now.py",
        "wave2": "dispatch_wave2_500_friday.py",
        "wave3": "dispatch_wave3_1000_saturday.py"
    }

    matching_key = None
    script_name = None

    for k in wave_scripts:
        if k == wave_name or k.replace("_", "") == wave_name.replace("_", "").replace("-", ""):
            matching_key = k
            script_name = wave_scripts[k]
            break

    # If not in static dict, check if wave_name is directly a script in campaigns
    if not script_name:
        for check_dir in [Path("/opt/unifonic_app/campaigns"), APP_DIR.parent / "exports" / "campaign_batches"]:
            if check_dir.exists():
                for sp in check_dir.rglob("dispatch_*.py"):
                    if wave_name in sp.name or wave_name.replace("_", "") in sp.name.replace("_", ""):
                        matching_key = wave_name
                        script_name = sp.name
                        break
            if script_name:
                break

    if not script_name:
        return JSONResponse(
            status_code=400,
            content={"success": False, "error": f"Unknown wave: {wave_name}."}
        )
    import subprocess

    # VPS paths
    vps_python = Path("/opt/unifonic_app/venv/bin/python3")
    vps_script = Path("/opt/unifonic_app/campaigns") / script_name
    vps_cwd = Path("/opt/unifonic_app")

    if vps_python.exists() and vps_script.exists():
        python_bin = str(vps_python)
        target_script = str(vps_script)
        working_dir = str(vps_cwd)
        env = os.environ.copy()
        env["PYTHONPATH"] = "/opt/unifonic_app"
    else:
        python_bin = sys.executable
        target_script = str(APP_DIR.parent / script_name)
        working_dir = str(APP_DIR.parent)
        env = os.environ.copy()

    # Check if already running
    try:
        if os.name != 'nt':
            check = subprocess.run(["pgrep", "-f", script_name], capture_output=True, text=True)
            if check.stdout.strip():
                return {
                    "success": True,
                    "status": "ALREADY_RUNNING",
                    "message": f"{script_name} is already active and running.",
                    "wave": matching_key
                }
    except Exception:
        pass

    # Launch in background
    log_file_path = Path("/opt/unifonic_app/campaigns") / f"{matching_key}_run.log" if Path("/opt/unifonic_app/campaigns").exists() else Path(working_dir) / f"{matching_key}_run.log"
    log_out = open(log_file_path, "a", encoding="utf-8")

    proc = subprocess.Popen(
        [python_bin, target_script],
        cwd=working_dir,
        env=env,
        stdout=log_out,
        stderr=log_out,
        start_new_session=(os.name != 'nt')
    )

    return {
        "success": True,
        "status": "TRIGGERED",
        "wave": matching_key,
        "script": script_name,
        "pid": proc.pid,
        "admin_alert": "+966569809578 (Template alert will arrive at start)",
        "message": f"Successfully launched {script_name} (PID: {proc.pid}).",
        "status_url": f"/api/waves/status/{matching_key}"
    }


@app.get("/api/waves/logs/{wave_name}")
async def get_wave_live_logs(wave_name: str):
    """Returns the tail output of the wave log file."""
    log_candidates_map = {
        "96sar_w1": [
            Path("/opt/unifonic_app/campaigns/wave1_96sar.log"),
            Path("/opt/unifonic_app/campaigns/send_list_96sar_wave1_300_today_dispatch_log.csv")
        ],
        "96sar_w2": [
            Path("/opt/unifonic_app/campaigns/wave2_96sar.log"),
            Path("/opt/unifonic_app/campaigns/send_list_96sar_wave2_300_tomorrow_dispatch_log.csv")
        ],
        "96sar_w3": [
            Path("/opt/unifonic_app/campaigns/wave3_96sar.log"),
            Path("/opt/unifonic_app/campaigns/send_list_96sar_wave3_257_remaining_dispatch_log.csv")
        ],
        "winback_200": [
            Path("/opt/unifonic_app/campaigns/wave_winback_200.log"),
            Path("/opt/unifonic_app/campaigns/send_list_winback_200_oct10_dispatch_log.csv")
        ],
        "cmp26_w5": [
            Path("/opt/unifonic_app/campaigns/wave5_cmp00026.log"),
            Path("/opt/unifonic_app/campaigns/cmp_00026_wave5_253_saturday_dispatch_log.csv")
        ],
        "cmp26_w4": [
            Path("/opt/unifonic_app/campaigns/wave4_cmp00026.log"),
            Path("/opt/unifonic_app/campaigns/cmp_00026_wave4_150_friday_dispatch_log.csv")
        ],
        "cmp26_w1": [
            Path("/opt/unifonic_app/campaigns/wave1_cmp00026.log"),
            Path("/opt/unifonic_app/campaigns/cmp26_w1_run.log"),
            Path("/opt/unifonic_app/campaigns/cmp_00026_wave1_346_sunday_dispatch_log.csv")
        ],
        "cmp26_w2": [
            Path("/opt/unifonic_app/campaigns/wave2_cmp00026.log"),
            Path("/opt/unifonic_app/campaigns/cmp26_w2_run.log"),
            Path("/opt/unifonic_app/campaigns/cmp_00026_wave2_346_monday_dispatch_log.csv")
        ],
        "cmp26_w3": [
            Path("/opt/unifonic_app/campaigns/wave3_cmp00026.log"),
            Path("/opt/unifonic_app/campaigns/cmp26_w3_run.log"),
            Path("/opt/unifonic_app/campaigns/cmp_00026_wave3_346_tuesday_dispatch_log.csv")
        ],
        "wave1": [
            Path("/opt/unifonic_app/campaigns/wave1.log"),
            Path("/opt/unifonic_app/wave1_run.log"),
            Path("/opt/unifonic_app/campaigns/cmp_00010_wave1_200_now_dispatch_log.csv")
        ],
        "wave2": [
            Path("/opt/unifonic_app/campaigns/wave2.log"),
            Path("/opt/unifonic_app/campaigns/cmp_00010_wave2_500_friday_dispatch_log.csv")
        ],
        "wave3": [
            Path("/opt/unifonic_app/campaigns/wave3.log"),
            Path("/opt/unifonic_app/campaigns/cmp_00010_wave3_1000_saturday_dispatch_log.csv")
        ]
    }

    matching_wave = wave_name
    candidates = list(log_candidates_map.get(wave_name, []))
    
    # Also dynamically discover logs matching wave_name in /opt/unifonic_app/campaigns
    camp_dir = Path("/opt/unifonic_app/campaigns")
    if camp_dir.exists():
        for f in camp_dir.glob(f"*{wave_name}*"):
            if f.is_file() and (f.suffix in [".log", ".csv", ".txt"]) and f not in candidates:
                candidates.append(f)
        candidates.append(camp_dir / f"{wave_name}.log")
        candidates.append(camp_dir / f"{wave_name}_run.log")

    content = ""
    for candidate in candidates:
        if candidate.exists() and candidate.stat().st_size > 0:
            try:
                with open(candidate, "r", encoding="utf-8", errors="ignore") as f:
                    lines = f.readlines()
                    content = "".join(lines[-80:])
                if content:
                    break
            except Exception:
                pass

    if not content:
        content = f"[{datetime.now(timezone.utc).strftime('%H:%M:%S UTC')}] Standing by. No active log output yet for {matching_wave}."

    return {"success": True, "wave": matching_wave, "log": content}


def _next_fixed_cron_run(expr: str) -> Optional[datetime]:
    """Next UTC run for a one-off 'min hour dom month *' cron expression, or None if it has no future run."""
    parts = expr.split()
    if len(parts) != 5 or not all(p.isdigit() for p in parts[:4]):
        return None
    minute, hour, dom, month = (int(p) for p in parts[:4])
    now = datetime.now(timezone.utc)
    try:
        run = datetime(now.year, month, dom, hour, minute, tzinfo=timezone.utc)
    except ValueError:
        return None
    return run if run > now else None


@app.get("/api/cron/list")
async def get_cron_schedule_list():
    """Dynamically parses live Linux crontab and returns schedule entries with execution statuses and next runs."""
    import subprocess
    entries = []
    
    # Map known scripts to their VPS dispatch logs
    script_log_map = {
        "dispatch_96sar_wave1_300_saturday.py": Path("/opt/unifonic_app/campaigns/send_list_96sar_wave1_300_today_dispatch_log.csv"),
        "dispatch_96sar_wave2_300_sunday.py": Path("/opt/unifonic_app/campaigns/send_list_96sar_wave2_300_tomorrow_dispatch_log.csv"),
        "dispatch_96sar_wave3_257_monday.py": Path("/opt/unifonic_app/campaigns/send_list_96sar_wave3_257_remaining_dispatch_log.csv"),
        "vps_dispatch_winback_200.py": Path("/opt/unifonic_app/campaigns/send_list_winback_200_oct10_dispatch_log.csv"),
        "dispatch_cmp00026_wave5_253_saturday.py": Path("/opt/unifonic_app/campaigns/cmp_00026_wave5_253_saturday_dispatch_log.csv"),
        "dispatch_cmp00026_wave4_150_friday.py": Path("/opt/unifonic_app/campaigns/cmp_00026_wave4_150_friday_dispatch_log.csv"),
        "dispatch_cmp00026_wave1_346_sunday.py": Path("/opt/unifonic_app/campaigns/cmp_00026_wave1_346_sunday_dispatch_log.csv"),
        "dispatch_cmp00026_wave2_346_monday.py": Path("/opt/unifonic_app/campaigns/cmp_00026_wave2_346_monday_dispatch_log.csv"),
        "dispatch_cmp00026_wave3_346_tuesday.py": Path("/opt/unifonic_app/campaigns/cmp_00026_wave3_346_tuesday_dispatch_log.csv"),
        "dispatch_wave2_500_friday.py": Path("/opt/unifonic_app/campaigns/cmp_00010_wave2_500_friday_dispatch_log.csv"),
        "dispatch_wave3_1000_saturday.py": Path("/opt/unifonic_app/campaigns/cmp_00010_wave3_1000_saturday_dispatch_log.csv"),
    }

    try:
        if os.name != 'nt':
            proc = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
            cron_text = proc.stdout
        else:
            cron_text = ""
        
        lines = cron_text.splitlines()
        last_comment = ""
        for line in lines:
            line_str = line.strip()
            if not line_str:
                continue
            if line_str.startswith("#"):
                cleaned = line_str.replace("===", "").strip().lstrip("#").strip()
                if cleaned:
                    last_comment = cleaned
                continue
            
            parts = line_str.split(None, 5)
            if len(parts) >= 6:
                expr = " ".join(parts[:5])
                cmd = parts[5]
                script = ""
                for segment in cmd.split():
                    if segment.endswith(".py"):
                        script = Path(segment).name
                        break
                if not script:
                    script = cmd.split(">")[0].strip()

                # Determine live status
                status = "ACTIVE"
                status_type = "active"
                next_run_iso = None

                # 1. Check if running right now
                if script and os.name != 'nt':
                    try:
                        p_check = subprocess.run(["pgrep", "-f", script], capture_output=True, text=True)
                        if p_check.stdout.strip():
                            status = "DISPATCHING NOW"
                            status_type = "running"
                    except Exception:
                        pass

                # 2. Check if completed or scheduled
                if status_type != "running":
                    if "sync_mongo" in cmd:
                        status = "RECURRING (Hourly)"
                        status_type = "hourly"
                        # Next run is top of next hour
                        now_utc = datetime.now(timezone.utc)
                        next_top = (now_utc.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1))
                        next_run_iso = next_top.isoformat()
                    elif script:
                        log_f = script_log_map.get(script)
                        if not log_f and script.startswith("dispatch_") and script.endswith(".py"):
                            # Dynamic mapping: dispatch_X.py -> send_list_X_dispatch_log.csv
                            base_part = script[len("dispatch_"):-3]
                            log_f = Path("/opt/unifonic_app/campaigns") / f"send_list_{base_part}_dispatch_log.csv"

                        if log_f and log_f.exists() and log_f.stat().st_size > 100:
                            status = "COMPLETED"
                            status_type = "completed"
                        else:
                            status = "SCHEDULED"
                            status_type = "scheduled"
                    
                    if status_type == "scheduled":
                        # Derive the next run from the cron expression (VPS clock is UTC)
                        next_dt = _next_fixed_cron_run(expr)
                        if next_dt:
                            next_run_iso = next_dt.isoformat()
                            ast = next_dt + timedelta(hours=3)
                            status = f"SCHEDULED ({ast.strftime('%b %d %H:%M')} AST)"
                        else:
                            status = "SCHEDULED (Date passed - no dispatch log)"

                entries.append({
                    "expression": expr,
                    "command": cmd,
                    "script": script,
                    "title": last_comment or script,
                    "status": status,
                    "status_type": status_type,
                    "next_run_iso": next_run_iso
                })
                last_comment = ""
    except Exception as e:
        logger.warning(f"Error fetching crontab: {e}")

    return JSONResponse(
        content={"success": True, "crons": entries},
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"}
    )


@app.get("/cron", response_class=HTMLResponse)
@app.get("/waves", response_class=HTMLResponse)
@app.get("/campaigns/schedule", response_class=HTMLResponse)
async def cron_dashboard_page(request: Request):
    """Interactive Cron Jobs & Campaign Command Center Webpage with zero-cache headers."""
    return HTMLResponse(
        content=render_cron_dashboard_html(PUBLIC_HTTPS_URL),
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0"
        }
    )


@app.get("/", response_class=HTMLResponse)
async def full_solution_ui(request: Request):
    """Complete WhatsApp solution: Live Chats, Delivery Reports (DLR), and Raw Webhook Feed."""
    code = request.query_params.get("code")
    if code:
        try:
            logger.info("Auto-exchanging Snapchat OAuth code from redirect URL...")
            ads_service.exchange_snapchat_code(code, "https://whatsapp.rush.com.sa")
        except Exception as e:
            logger.error(f"Auto Snapchat OAuth exchange error: {e}")

    return HTMLResponse(
        content=render_full_solution_ui(
            public_https_url=PUBLIC_HTTPS_URL,
            unifonic_public_id=current_settings.get("public_id") or UNIFONIC_PUBLIC_ID,
            unifonic_channel_id=current_settings.get("channel_id") or UNIFONIC_CHANNEL_ID
        )
    )


# ---------------------------------------------------------------------------
# Rush Wash Operations Hub & AI Copilot Routes
# ---------------------------------------------------------------------------
from unifonic_app.copilot_engine import (
    generate_support_reply,
    generate_review_reply,
    format_whatsapp_renewal_template,
    POLICIES
)
from unifonic_app.copilot_ui import (
    copilot_studio_html,
    copilot_sidebar_html
)
from unifonic_app.ops_service import (
    get_failed_renewals_cohort,
    lookup_customer
)

class SupportPromptRequest(BaseModel):
    scenario: str = "custom"
    user_inquiry: str
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    extra_context: Optional[str] = None

class ReviewPromptRequest(BaseModel):
    review_text: str
    stars: int = 5

class WhatsAppFormatRequest(BaseModel):
    customer_name: str = "العميل"
    package_name: str = "منعش"
    plate: str = "المركبة"
    failed_amount: float = 179.0
    failed_date: Optional[str] = None

@app.get("/ops", response_class=HTMLResponse)
@app.get("/copilot", response_class=HTMLResponse)
async def ops_hub_page(request: Request):
    """Operations Hub and AI Copilot Studio."""
    return HTMLResponse(
        content=copilot_studio_html(),
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"}
    )

@app.get("/copilot/sidebar", response_class=HTMLResponse)
async def chatwoot_sidebar_page(request: Request):
    """Chatwoot Dashboard App Sidebar Widget."""
    return HTMLResponse(
        content=copilot_sidebar_html(),
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"}
    )

class SendFailedRenewalsRequest(BaseModel):
    scope: Optional[str] = "today_first_attempt"
    subscription_codes: Optional[List[str]] = None
    force_resend: Optional[bool] = False

@app.get("/api/ops/failed-renewals/cohort")
async def api_failed_renewals_cohort(
    scope: str = Query("today_first_attempt", description="Cohort scope: today_first_attempt, today_all, all_uncollected"),
    limit: int = Query(1000, description="Max cohort size")
):
    """Scans and extracts members with failed card renewals in strict read-only mode."""
    data = await asyncio.to_thread(get_failed_renewals_cohort, scope=scope, limit=limit)
    return JSONResponse(
        content=data,
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
        }
    )

@app.post("/api/ops/failed-renewals/send")
async def api_send_failed_renewals(req: SendFailedRenewalsRequest):
    """
    1-Click WhatsApp Sender for Meta-approved template renewal_payment_failed_ar.
    Dispatches to members whose renewal failed, with automatic 24-hour duplicate prevention.
    """
    from unifonic_app.unifonic_client import send_whatsapp_message, format_e164_phone
    from unifonic_app.storage import storage
    from unifonic_app.models import NormalizedWhatsAppEvent

    # Get cohort based on requested scope
    cohort_data = await asyncio.to_thread(get_failed_renewals_cohort, scope=req.scope or "today_first_attempt", limit=1000)
    recipients = cohort_data.get("cohort", [])

    # If specific subscription codes are specified (e.g. single row send)
    if req.subscription_codes and len(req.subscription_codes) > 0:
        target_codes = set(req.subscription_codes)
        recipients = [r for r in recipients if r.get("subscription_code") in target_codes]

    if not recipients:
        return JSONResponse(content={
            "success": True,
            "sent_count": 0,
            "failed_count": 0,
            "skipped_count": 0,
            "message": "No eligible recipients found in this scope."
        })

    # Check recent messages in last 24h to prevent double-messaging
    cutoff_24h = datetime.now(timezone.utc) - timedelta(hours=24)
    recently_sent_phones = set()
    log_file = Path(__file__).resolve().parent / "logs" / "whatsapp_events.jsonl"
    if log_file.exists():
        try:
            with open(log_file, "r", encoding="utf-8") as f:
                for line in f:
                    if not line.strip(): continue
                    try:
                        rec = json.loads(line)
                        if rec.get("template") == "renewal_payment_failed_ar" or "تجديد اشتراكك في رش واش" in str(rec.get("content", "")):
                            t_str = rec.get("timestamp") or rec.get("created_at")
                            if t_str:
                                t_dt = datetime.fromisoformat(str(t_str).replace("Z", "+00:00"))
                                if t_dt >= cutoff_24h:
                                    phone_rec = rec.get("recipient") or rec.get("customer_phone")
                                    if phone_rec:
                                        recently_sent_phones.add(format_e164_phone(phone_rec))
                    except Exception:
                        pass
        except Exception as e:
            logger.warning(f"Error reading whatsapp_events.jsonl: {e}")

    sent_count = 0
    failed_count = 0
    skipped_count = 0
    details = []

    for r in recipients:
        phone = format_e164_phone(r.get("phone"))
        if not phone:
            failed_count += 1
            details.append({"phone": r.get("phone"), "status": "INVALID_PHONE"})
            continue

        if not req.force_resend and phone in recently_sent_phones:
            skipped_count += 1
            details.append({"phone": phone, "name": r.get("name"), "status": "SKIPPED_ALREADY_MESSAGED_24H"})
            continue

        # Template variables for renewal_payment_failed_ar
        # {{1}} Customer name, {{2}} Plan (Arabic), {{3}} Plate, {{4}} Amount, {{5}} Deadline
        tpl_vars = [
            r.get("name") or "العميل",
            r.get("plan_ar") or "الاشتراك",
            r.get("plate") or "المركبة",
            str(r.get("amount") or "179"),
            r.get("deadline") or "قبل 21 أكتوبر 2026"
        ]

        try:
            res = send_whatsapp_message(
                to_phone=phone,
                text=r.get("rendered_message", ""),
                template_name="renewal_payment_failed_ar",
                template_language="ar",
                template_vars=tpl_vars
            )

            if res.get("success"):
                sent_count += 1
                msg_id = res.get("message_id")
                recently_sent_phones.add(phone)
                storage.save_event(NormalizedWhatsAppEvent(
                    event_type="outbound_message",
                    recipient=phone,
                    customer_phone=phone,
                    message_id=msg_id,
                    content=r.get("rendered_message", ""),
                    status="SENT"
                ))
                # Automatically sync outbound notice to Chatwoot in background
                try:
                    asyncio.create_task(asyncio.to_thread(
                        sync_outbound_to_chatwoot,
                        to_phone=phone,
                        content=r.get("rendered_message", ""),
                        message_id=msg_id,
                        campaign_name="renewal_payment_failed_ar",
                        customer_name=r.get("name") or "Rush Member",
                        sender_name="Rush Wash Automation"
                    ))
                except Exception as cw_err:
                    logger.warning(f"[Chatwoot Sync] Failed renewal notice sync note: {cw_err}")

                details.append({
                    "subscription_code": r.get("subscription_code"),
                    "phone": phone,
                    "name": r.get("name"),
                    "status": "SENT",
                    "message_id": msg_id
                })
            else:
                failed_count += 1
                details.append({
                    "subscription_code": r.get("subscription_code"),
                    "phone": phone,
                    "status": "FAILED",
                    "error": res.get("error")
                })
        except Exception as e:
            failed_count += 1
            details.append({
                "subscription_code": r.get("subscription_code"),
                "phone": phone,
                "status": "ERROR",
                "error": str(e)
            })

        # Pacing delay
        await asyncio.sleep(0.1)

    return JSONResponse(content={
        "success": True,
        "scope": req.scope,
        "total_targeted": len(recipients),
        "sent_count": sent_count,
        "failed_count": failed_count,
        "skipped_count": skipped_count,
        "details": details
    })

@app.get("/api/ops/customer-lookup")
async def api_customer_lookup(q: str = Query(..., description="Phone, plate, or code")):
    """Safe read-only customer and subscription 360 search."""
    data = await asyncio.to_thread(lookup_customer, query=q)
    return JSONResponse(content=data)

@app.post("/api/copilot/generate")
async def api_copilot_generate(req: SupportPromptRequest):
    """Generates policy-compliant Saudi Arabic and English support replies."""
    res = await asyncio.to_thread(
        generate_support_reply,
        scenario=req.scenario,
        user_inquiry=req.user_inquiry,
        customer_name=req.customer_name,
        customer_phone=req.customer_phone,
        extra_context=req.extra_context
    )
    return JSONResponse(content=res)

@app.post("/api/copilot/review-reply")
async def api_copilot_review_reply(req: ReviewPromptRequest):
    """Generates Google Maps review replies adhering to Rush SOP."""
    res = await asyncio.to_thread(
        generate_review_reply,
        review_text=req.review_text,
        stars=req.stars
    )
    return JSONResponse(content=res)

@app.post("/api/copilot/format-whatsapp")
async def api_copilot_format_whatsapp(req: WhatsAppFormatRequest):
    """Formats and calculates variables for Meta utility template renewal_payment_failed_ar."""
    res = await asyncio.to_thread(
        format_whatsapp_renewal_template,
        customer_name=req.customer_name,
        package_name=req.package_name,
        plate=req.plate,
        failed_amount=req.failed_amount,
        failed_date_iso=req.failed_date
    )
    return JSONResponse(content=res)

@app.get("/api/ops/sync-status")
async def api_ops_sync_status():
    """Returns the latest read-only Atlas dump metadata."""
    from unifonic_app.ops_service import get_sync_metadata
    meta = await asyncio.to_thread(get_sync_metadata)
    return JSONResponse(
        content=meta,
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
        }
    )

@app.post("/api/ops/sync-atlas-dump")
async def api_ops_trigger_atlas_dump():
    """Manually triggers a read-only Atlas dump to update the local VPS snapshot."""
    from vps_atlas_readonly_dump import run_readonly_dump
    try:
        res = await asyncio.to_thread(run_readonly_dump)
        return JSONResponse(content={"success": True, "result": res})
    except Exception as e:
        logger.error(f"Manual Atlas dump error: {e}")
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})

# ------------------------------------------------------------------------------
# 10K Growth & Retention Dashboard Router Integration
# ------------------------------------------------------------------------------
@app.get("/ops/growth", response_class=HTMLResponse)
@app.get("/ops/growth/", response_class=HTMLResponse)
@app.get("/growth", response_class=HTMLResponse)
@app.get("/growth/", response_class=HTMLResponse)
async def ops_growth_dashboard_page(request: Request):
    """10K Growth & Retention Dashboard Page."""
    html_paths = [
        "/opt/unifonic_app/exports/rush_10k_growth_dashboard.html",
        os.path.join(APP_DIR.parent, "exports", "rush_10k_growth_dashboard.html"),
        os.path.join(APP_DIR, "exports", "rush_10k_growth_dashboard.html")
    ]
    for hp in html_paths:
        if os.path.exists(hp):
            with open(hp, "r", encoding="utf-8") as f:
                return HTMLResponse(content=f.read())
    return HTMLResponse(content="<h1>Growth Dashboard HTML not found in exports/</h1>", status_code=404)

# ------------------------------------------------------------------------------
# Dedicated Customer Lifecycle Funnel & Cadence Studio (/funnel)
# ------------------------------------------------------------------------------
from unifonic_app.funnel_ui import render_lifecycle_funnel_html

@app.get("/funnel", response_class=HTMLResponse)
@app.get("/funnel/", response_class=HTMLResponse)
@app.get("/lifecycle", response_class=HTMLResponse)
@app.get("/lifecycle/", response_class=HTMLResponse)
@app.get("/ops/funnel", response_class=HTMLResponse)
async def lifecycle_funnel_standalone_page(request: Request):
    """Dedicated Customer Lifecycle Funnel & Cadence Studio Page."""
    return HTMLResponse(content=render_lifecycle_funnel_html())

try:
    import growth_dashboard_server as growth_module
    app.include_router(growth_module.app.router)
    logger.info("Successfully mounted Growth & CRM Dashboard API router into WhatsApp Hub.")
except Exception as e:
    logger.warning(f"Growth router auto-mount deferred: {e}")





# ------------------------------------------------------------------------------
# Free First Wash (CMP-00032) Manual Verification & Dispatch Hub
# ------------------------------------------------------------------------------
from unifonic_app.freewash_ui import render_freewash_ui_html
from unifonic_app.freewash_service import evaluate_freewash_cohort, get_freewash_redemption_stats, sync_freewash_db

def _get_freewash_files():
    aud_candidates = [
        Path("/ops/cmp-00032_audience_91.csv"),
        Path("/ops/cmp-00032_audience_79.csv"),
        APP_DIR.parent / "exports" / "cmp-00032_audience_91.csv",
        APP_DIR.parent / "exports" / "cmp-00032_audience_79.csv",
        Path("exports/cmp-00032_audience_91.csv"),
        Path("exports/cmp-00032_audience_79.csv"),
    ]
    aud_file = next((f for f in aud_candidates if f.exists()), None)

    log_candidates = [
        Path("/ops/portal_freewash_sent_log.csv"),
        APP_DIR.parent / "exports" / "portal_freewash_sent_log.csv",
        Path("exports/portal_freewash_sent_log.csv"),
    ]
    log_file = next((f for f in log_candidates if f.exists()), None)

    if not aud_file:
        aud_file = APP_DIR.parent / "exports" / "cmp-00032_audience_79.csv"
    if not log_file:
        log_file = (Path("/ops") if Path("/ops").exists() else (APP_DIR.parent / "exports")) / "portal_freewash_sent_log.csv"

    return aud_file, log_file

@app.get("/freewash", response_class=HTMLResponse)
@app.get("/ops/freewash", response_class=HTMLResponse)
async def freewash_dashboard_page(request: Request):
    """Interactive Command Center & Redemption Dashboard for CMP-00032 Free First Wash."""
    return HTMLResponse(content=render_freewash_ui_html())

@app.get("/api/freewash/recipients")
async def api_freewash_recipients(all_history: bool = False, include_today: bool = True):
    """Returns dynamic qualifying recipients up to now with real-time sent & redemption status."""
    try:
        recipients = await asyncio.to_thread(evaluate_freewash_cohort, include_all_history=all_history, include_today=include_today)
        return JSONResponse(content={"recipients": recipients, "total": len(recipients)})
    except Exception as e:
        logger.warning(f"Error evaluating live cohort from MongoDB: {e}, falling back to CSV")
        aud_path, log_path = _get_freewash_files()
        sent_map = {}
        if log_path.exists():
            try:
                with open(log_path, mode="r", encoding="utf-8-sig") as f:
                    for r in csv.DictReader(f):
                        cc = (r.get("Customer Code") or "").strip()
                        ph = (r.get("Phone Number") or "").strip()
                        if cc: sent_map[cc] = r
                        if ph: sent_map[ph] = r
            except Exception as log_err:
                logger.warning(f"Error reading freewash log: {log_err}")

        recipients = []
        if aud_path.exists():
            try:
                with open(aud_path, mode="r", encoding="utf-8-sig") as f:
                    for r in csv.DictReader(f):
                        cc = r.get("Customer Code", "").strip()
                        ph = r.get("Phone Number", "").strip()
                        signup_ast = r.get("Signup (AST)", "")
                        last_login_ast = r.get("Last Login (AST)", "")
                        sent_info = sent_map.get(cc) or sent_map.get(ph)
                        st = (sent_info.get("Status") if sent_info else "UNSENT") or "UNSENT"
                        cw_id = (sent_info.get("Chatwoot Conversation ID") if sent_info else "") or ""
                        recipients.append({
                            "customer_code": cc,
                            "customer_name": r.get("Customer Name", "عميل رش"),
                            "phone": ph,
                            "signup_ast": signup_ast,
                            "source": "Portal signup",
                            "last_login_ast": last_login_ast,
                            "revisit": bool(signup_ast and last_login_ast and signup_ast != last_login_ast),
                            "coupon_expiry_ast": "2026-10-27 11:59 PM AST",
                            "status": st,
                            "chatwoot_conversation_id": cw_id,
                            "redemption_status": "PENDING"
                        })
            except Exception as parse_err:
                logger.error(f"Error parsing fallback audience file: {parse_err}")
        return JSONResponse(content={"recipients": recipients, "total": len(recipients)})

@app.get("/api/freewash/redemption-stats")
async def api_freewash_redemption_stats(include_today: bool = True):
    """Returns live redemption metrics, conversion funnel, and expiry status."""
    try:
        stats = await asyncio.to_thread(get_freewash_redemption_stats, include_today=include_today)
        return JSONResponse(content=stats)
    except Exception as e:
        logger.error(f"Error computing freewash redemption stats: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.post("/api/freewash/update-db")
async def api_freewash_update_db():
    """
    Triggers read-only incremental sync from Atlas to local MongoDB,
    and returns newly evaluated eligible customers.
    """
    try:
        result = await asyncio.to_thread(sync_freewash_db)
        return JSONResponse(content=result)
    except Exception as e:
        logger.error(f"Error in api_freewash_update_db: {e}", exc_info=True)
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})

class SendTestRequest(BaseModel):
    phone: str

@app.post("/api/freewash/send-test")
async def api_freewash_send_test(req: SendTestRequest):
    """Sends a single test message to a specified mobile number and syncs to Chatwoot."""
    phone = req.phone.strip()
    if not phone:
        return JSONResponse(status_code=400, content={"success": False, "error": "Phone number required"})

    e164 = format_e164_phone(phone)
    res = await asyncio.to_thread(
        send_whatsapp_message,
        to_phone=e164,
        template_name="firstwash_bulk",
        template_language="ar",
        template_vars=["FIRSTWASH7"],
        public_id=UNIFONIC_PUBLIC_ID,
        secret_key=UNIFONIC_SECRET_KEY,
        channel_id=UNIFONIC_CHANNEL_ID
    )

    is_ok = res.get("success", False)
    msg_id = res.get("message_id")
    cw_id = None

    if is_ok:
        actual_message = "حياك الله في رش! غسلتك الأولى علينا. استخدم الرمز FIRSTWASH7 عند مسار المبيعات خلال ٧ أيام واستمتع بغسلة نانو مجانية."
        try:
            cw_res = await asyncio.to_thread(
                sync_outbound_to_chatwoot,
                to_phone=e164,
                content=actual_message,
                message_id=msg_id,
                campaign_name="CMP-00032",
                customer_name="Internal Test Verification",
                sender_name="Rush Wash Automation"
            )
            if isinstance(cw_res, dict):
                cw_id = cw_res.get("conversation_id")
            elif isinstance(cw_res, (int, str)):
                cw_id = cw_res
        except Exception as e:
            logger.warning(f"Chatwoot sync error on test: {e}")

    return JSONResponse(content={
        "success": is_ok,
        "message_id": msg_id,
        "chatwoot_conversation_id": cw_id,
        "error": res.get("error") if not is_ok else ""
    })

class SendSingleRequest(BaseModel):
    customer_code: str

@app.post("/api/freewash/send-single")
async def api_freewash_send_single(req: SendSingleRequest):
    """Manually dispatches to a single customer with strict idempotency and Chatwoot sync."""
    code = req.customer_code.strip()
    aud_path, log_path = _get_freewash_files()

    # 1. Lookup candidate dynamically or via CSV
    target = None
    try:
        candidates = await asyncio.to_thread(evaluate_freewash_cohort, include_all_history=False)
        for c in candidates:
            if c.get("customer_code") == code:
                target = {
                    "Customer Code": c.get("customer_code"),
                    "Customer Name": c.get("customer_name"),
                    "Phone Number": c.get("phone"),
                    "Signup (AST)": c.get("signup_ast"),
                    "Last Login (AST)": c.get("last_login_ast")
                }
                break
    except Exception as e:
        logger.warning(f"Error checking live cohort for customer {code}: {e}")

    if not target and aud_path.exists():
        with open(aud_path, mode="r", encoding="utf-8-sig") as f:
            for r in csv.DictReader(f):
                if (r.get("Customer Code") or "").strip() == code:
                    target = r
                    break

    if not target:
        return JSONResponse(status_code=404, content={"success": False, "error": f"Customer {code} not found in qualifying audience"})

    raw_phone = target.get("Phone Number", "").strip()
    e164 = format_e164_phone(raw_phone)
    name = target.get("Customer Name", "عميل رش")
    signup_ast = target.get("Signup (AST)", "")
    last_login_ast = target.get("Last Login (AST)", "")

    # 2. Strict Idempotency Check
    if log_path.exists():
        with open(log_path, mode="r", encoding="utf-8-sig") as f:
            for r in csv.DictReader(f):
                if (r.get("Customer Code") == code or r.get("Phone Number") == e164) and (r.get("Status") or "").upper() in ["SENT", "DELIVERED", "READ", "QUEUED"]:
                    return JSONResponse(content={"success": True, "already_sent": True, "message": f"Customer {code} was already messaged"})

    # 3. WhatsApp dispatch
    res = await asyncio.to_thread(
        send_whatsapp_message,
        to_phone=e164,
        template_name="firstwash_bulk",
        template_language="ar",
        template_vars=["FIRSTWASH7"],
        public_id=UNIFONIC_PUBLIC_ID,
        secret_key=UNIFONIC_SECRET_KEY,
        channel_id=UNIFONIC_CHANNEL_ID
    )

    is_ok = res.get("success", False)
    msg_id = res.get("message_id")
    error = res.get("error") if not is_ok else ""

    now_ast = (datetime.now(timezone.utc) + timedelta(hours=3)).strftime("%Y-%m-%d %I:%M %p AST")
    expiry_ast = "2026-10-27 11:59 PM AST"

    cw_id = None
    if is_ok:
        actual_message = "حياك الله في رش! غسلتك الأولى علينا. استخدم الرمز FIRSTWASH7 عند مسار المبيعات خلال ٧ أيام واستمتع بغسلة نانو مجانية."
        try:
            cw_res = await asyncio.to_thread(
                sync_outbound_to_chatwoot,
                to_phone=e164,
                content=actual_message,
                message_id=msg_id,
                campaign_name="CMP-00032",
                customer_name=name,
                sender_name="Rush Wash Automation"
            )
            if isinstance(cw_res, dict):
                cw_id = cw_res.get("conversation_id")
            elif isinstance(cw_res, (int, str)):
                cw_id = cw_res
        except Exception as e:
            logger.warning(f"Chatwoot sync error: {e}")

    # 4. Append to sent log CSV
    fieldnames = [
        "Customer Code", "Customer Name", "Phone Number", "Status",
        "WhatsApp Message ID", "Template", "Promo Code", "Chatwoot Conversation ID",
        "Last Login (AST)", "Signup (AST)", "Coupon Expiry (AST)", "Timestamp (AST)", "Error"
    ]
    file_exists = log_path.exists() and log_path.stat().st_size > 0
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with open(log_path, mode="a", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        if not file_exists:
            writer.writeheader()
        writer.writerow({
            "Customer Code": code,
            "Customer Name": name,
            "Phone Number": e164,
            "Status": "SENT" if is_ok else "FAILED",
            "WhatsApp Message ID": msg_id or "",
            "Template": "firstwash_bulk",
            "Promo Code": "FIRSTWASH7",
            "Chatwoot Conversation ID": str(cw_id) if cw_id else "",
            "Last Login (AST)": last_login_ast,
            "Signup (AST)": signup_ast,
            "Coupon Expiry (AST)": expiry_ast,
            "Timestamp (AST)": now_ast,
            "Error": error
        })

    return JSONResponse(content={
        "success": is_ok,
        "customer_code": code,
        "message_id": msg_id,
        "chatwoot_conversation_id": cw_id,
        "error": error
    })


# ==========================================
# DAY-23 NEW MEMBER RENEWAL SUMMARY ROUTES
# ==========================================
from .day23_service import (
    evaluate_day23_cohort,
    dispatch_day23_test_message,
    dispatch_day23_single,
    DEFAULT_TEMPLATE as DAY23_DEFAULT_TEMPLATE,
)
from .day23_ui import render_day23_ui_html


@app.get("/day23", response_class=HTMLResponse)
@app.get("/ops/day23-renewals", response_class=HTMLResponse)
async def day23_renewals_dashboard():
    """Renders the Day-23 New Member Renewal Value Summary dashboard."""
    return HTMLResponse(content=render_day23_ui_html())


@app.get("/api/day23/recipients")
async def api_day23_recipients(
    scope: str = Query("day23_today", description="day23_today, rolling_21_25, upcoming_7d, or custom"),
    target_day: int = Query(23, description="Membership day when scope=custom"),
    template_name: str = Query(DAY23_DEFAULT_TEMPLATE, description="WhatsApp template name"),
):
    """Evaluates Day-23 first-cycle members from local MongoDB with washes, retail value, and net savings."""
    try:
        data = await asyncio.to_thread(
            evaluate_day23_cohort,
            scope=scope,
            target_day=target_day,
            template_name=template_name,
        )
        return JSONResponse(content=data)
    except Exception as e:
        logger.error(f"Error evaluating Day-23 cohort: {e}")
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})


class Day23TestRequest(BaseModel):
    phone: str
    template_name: Optional[str] = DAY23_DEFAULT_TEMPLATE
    plate: Optional[str] = "8083XRR"
    washes: Optional[str] = "10"
    saved_sar: Optional[str] = "794"
    renewal_date_ar: Optional[str] = "30 أكتوبر 2026"


@app.post("/api/day23/send-test")
async def api_day23_send_test(req: Day23TestRequest):
    """Sends a test Day-23 renewal summary WhatsApp message and syncs a private note to Chatwoot."""
    res = await asyncio.to_thread(
        dispatch_day23_test_message,
        phone=req.phone,
        template_name=req.template_name or DAY23_DEFAULT_TEMPLATE,
        plate=req.plate or "8083XRR",
        washes=req.washes or "10",
        saved_sar=req.saved_sar or "794",
        renewal_date_ar=req.renewal_date_ar or "30 أكتوبر 2026",
    )
    status = 200 if res.get("success") else 400
    return JSONResponse(status_code=status, content=res)


class Day23SendSingleRequest(BaseModel):
    subscription_code: str
    template_name: Optional[str] = DAY23_DEFAULT_TEMPLATE
    scope: Optional[str] = "day23_today"
    target_day: Optional[int] = 23
    force_resend: Optional[bool] = False


@app.post("/api/day23/send-single")
async def api_day23_send_single(req: Day23SendSingleRequest):
    """Dispatches the Day-23 renewal summary to a single eligible subscription with strict idempotency."""
    res = await asyncio.to_thread(
        dispatch_day23_single,
        subscription_code=req.subscription_code,
        scope=req.scope or "day23_today",
        target_day=req.target_day or 23,
        template_name=req.template_name or DAY23_DEFAULT_TEMPLATE,
        force_resend=bool(req.force_resend),
    )
    return JSONResponse(content=res)


class Day23SendBatchRequest(BaseModel):
    scope: Optional[str] = "day23_today"
    target_day: Optional[int] = 23
    template_name: Optional[str] = DAY23_DEFAULT_TEMPLATE
    subscription_codes: Optional[List[str]] = None


@app.post("/api/day23/send-batch")
async def api_day23_send_batch(req: Day23SendBatchRequest):
    """Dispatches the Day-23 renewal summary to all eligible unsent recipients in the selected cohort."""
    scope = req.scope or "day23_today"
    target_day = req.target_day or 23
    template_name = req.template_name or DAY23_DEFAULT_TEMPLATE

    cohort = await asyncio.to_thread(
        evaluate_day23_cohort,
        scope=scope,
        target_day=target_day,
        template_name=template_name,
    )
    if not cohort.get("success"):
        return JSONResponse(status_code=500, content=cohort)

    eligible_list = cohort.get("recipients", [])
    allowed_codes = set(req.subscription_codes) if req.subscription_codes else None

    targets = [
        r for r in eligible_list
        if r.get("status") == "READY_TO_SEND"
        and (allowed_codes is None or r.get("subscription_code") in allowed_codes)
    ]

    sent_count = 0
    skipped_count = 0
    failed_count = 0
    results = []

    for rec in targets:
        res = await asyncio.to_thread(
            dispatch_day23_single,
            subscription_code=rec["subscription_code"],
            scope=scope,
            target_day=target_day,
            template_name=template_name,
            force_resend=False,
        )
        results.append(res)
        if res.get("already_sent"):
            skipped_count += 1
        elif res.get("success"):
            sent_count += 1
        else:
            failed_count += 1
        await asyncio.sleep(0.15)

    return JSONResponse(content={
        "success": True,
        "scope": scope,
        "template_name": template_name,
        "targeted": len(targets),
        "sent_count": sent_count,
        "skipped_count": skipped_count,
        "failed_count": failed_count,
        "results": results,
    })


@app.get("/api/day23/export-csv")
async def api_day23_export_csv(
    scope: str = Query("day23_today"),
    target_day: int = Query(23),
    template_name: str = Query(DAY23_DEFAULT_TEMPLATE),
    include_excluded: bool = Query(False),
):
    """Exports the evaluated Day-23 cohort and rendered template variables as a UTF-8-SIG CSV."""
    cohort = await asyncio.to_thread(
        evaluate_day23_cohort,
        scope=scope,
        target_day=target_day,
        template_name=template_name,
    )
    rows = list(cohort.get("recipients", []))
    if include_excluded:
        rows.extend(cohort.get("excluded_low_savings", []))

    output = io.StringIO()
    output.write("\ufeff")
    fieldnames = [
        "subscription_code",
        "customer_code",
        "customer_name",
        "phone",
        "package_code",
        "plan_en",
        "plan_ar",
        "promo_code",
        "initial_order_code",
        "plate",
        "washes_count",
        "single_wash_retail_sar",
        "paid_amount_sar",
        "retail_value_sar",
        "net_saved_sar",
        "created_date_ast",
        "days_since_created",
        "renewal_date_ast",
        "renewal_date_ar",
        "days_until_renewal",
        "var1",
        "var2",
        "var3",
        "var4",
        "template_name",
        "status",
        "rendered_message",
    ]
    writer = csv.DictWriter(output, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    for r in rows:
        writer.writerow(r)

    filename = f"day23_renewal_recipients_{scope}.csv"
    return Response(
        content=output.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
