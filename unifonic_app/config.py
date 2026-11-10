import os
from pathlib import Path
from dotenv import load_dotenv

# Base directory for the project and the unifonic_app
APP_DIR = Path(__file__).resolve().parent
PROJECT_DIR = APP_DIR.parent

# Load environment from project root .env
load_dotenv(PROJECT_DIR / ".env")
load_dotenv(APP_DIR / ".env")

# Network & Server Configuration
LOCAL_HOST = os.getenv("LOCAL_HOST", "127.0.0.1")
LOCAL_PORT = int(os.getenv("LOCAL_PORT", "8000"))

# VPS Proxy Configuration
VPS_HOST = os.getenv("VPS_HOST", "72.60.185.87")
VPS_PORT = int(os.getenv("VPS_PORT", "8090"))
SSH_PORT = int(os.getenv("SSH_PORT", "22"))
SSH_USER = os.getenv("SSH_USER", "root")
SSH_PASS = os.getenv("SSH_PASS", "+A')4bEMQn?ZwOO6eQ6s")

# Public Webhook URLs (HTTPS via VPS Apache reverse proxy)
PUBLIC_HTTPS_URL = "https://whatsapp.rush.com.sa/webhook/whatsapp"
PUBLIC_HTTPS_ALT_URL = "https://test.rush.com.sa/webhook/whatsapp"
PUBLIC_DIRECT_IP_URL = f"http://{VPS_HOST}:{VPS_PORT}/webhook/whatsapp"
PUBLIC_WEBHOOK_URL = PUBLIC_HTTPS_URL

# Unifonic Credentials
UNIFONIC_PUBLIC_ID = os.getenv("UNIFONIC_PUBLIC_ID", "92d3a815-4224-4f47-bf10-8eb91256230c")
UNIFONIC_SECRET_KEY = os.getenv("UNIFONIC_SECRET_KEY", "xb7xDyeMHp1KmSidpV5ZG5p0fGutMakOFQ8HkldmI0KqRs687T3CeXS0qh0hhZYCXB7XxfHl5rs")
UNIFONIC_CHANNEL_ID = os.getenv("UNIFONIC_CHANNEL_ID", "d6bb3874-a6f2-485f-bf43-7c6df97c2109")
UNIFONIC_APP_ID = os.getenv("UNIFONIC_APP_ID", "80bee0d0-9f5f-42eb-8225-5b80d6f5c0d7")
UNIFONIC_SENDER_ID = os.getenv("UNIFONIC_SENDER_ID", "RushWash")
UNIFONIC_BASE_URL = os.getenv("UNIFONIC_BASE_URL", "https://el.cloud.unifonic.com")
UNIFONIC_CONVERSATIONS_URL = os.getenv("UNIFONIC_CONVERSATIONS_URL", "https://apis.unifonic.com/v1/messages")

# Local Storage (Atlas Disabled by configuration)
MONGODB_URI = os.getenv("MONGODB_URI", "")
DB_NAME = "rushwash"
COLLECTION_NAME = "unifonic_whatsapp_events"

# Apple Wallet membership cards (env-only, no defaults for secrets; never commit certs)
WALLET_ENABLED = os.getenv("WALLET_ENABLED", "1").strip().lower() not in ("0", "false", "no", "off")
PASS_TYPE_ID = os.getenv("PASS_TYPE_ID", "")
APPLE_TEAM_ID = os.getenv("APPLE_TEAM_ID", "")
PASS_CERT_P12 = os.getenv("PASS_CERT_P12", "")
PASS_CERT_PASSWORD = os.getenv("PASS_CERT_PASSWORD", "")
WWDR_CERT_PATH = os.getenv("WWDR_CERT_PATH", "")
WALLET_TOKEN_SECRET = os.getenv("WALLET_TOKEN_SECRET", "")
WALLET_PUBLIC_BASE_URL = os.getenv("WALLET_PUBLIC_BASE_URL", "https://whatsapp.rush.com.sa").rstrip("/")
WALLET_ORG_NAME = os.getenv("WALLET_ORG_NAME", "Rush Wash")
WALLET_SUPPORT_PHONE = os.getenv("WALLET_SUPPORT_PHONE", "")
# Read-only lookups; local copy only (never Atlas).
WALLET_MONGODB_URI = os.getenv("WALLET_MONGODB_URI") or os.getenv("MONGODB_URI") or "mongodb://127.0.0.1:27017/rushwash"
# Branch geofences for the lock-screen "nearby" suggestion: "lat,lng,Name;lat,lng,Name" (max 10).
# Evaluated on the phone by Wallet; Rush never receives member locations.
WALLET_LOCATIONS = os.getenv("WALLET_LOCATIONS", "")
WALLET_LOCATION_TEXT = os.getenv("WALLET_LOCATION_TEXT", "Welcome to Rush Wash - show your card at the gate")
WALLET_LOCATION_DISTANCE_M = int(os.getenv("WALLET_LOCATION_DISTANCE_M", "300"))
# Call-to-action links shown on the back of the card (empty = hidden)
WALLET_RENEW_URL = os.getenv("WALLET_RENEW_URL", "")
WALLET_WHATSAPP_NUMBER = os.getenv("WALLET_WHATSAPP_NUMBER", "")  # digits with country code, e.g. 9665XXXXXXXX
WALLET_DIRECTIONS_URL = os.getenv("WALLET_DIRECTIONS_URL", "https://maps.apple.com/?ll=24.142062,47.276062&q=Rush%20Wash")
WALLET_SOURCE = os.getenv("WALLET_SOURCE", "mongo").strip().lower()  # mongo | snapshot
WALLET_SYNC_TOKEN = os.getenv("WALLET_SYNC_TOKEN", "")
WALLET_APNS_KEY_P8 = os.getenv("WALLET_APNS_KEY_P8", "")
WALLET_APNS_KEY_ID = os.getenv("WALLET_APNS_KEY_ID", "")
WALLET_APNS_SANDBOX = os.getenv("WALLET_APNS_SANDBOX", "0").strip().lower() in ("1", "true", "yes", "on")
WALLET_SYNC_INTERVAL_SEC = int(os.getenv("WALLET_SYNC_INTERVAL_SEC", "900"))

# Authentication Credentials
AUTH_USERNAME = os.getenv("AUTH_USERNAME", "admin")
AUTH_PASSWORD = os.getenv("AUTH_PASSWORD", "RushWash@2026")
SESSION_SECRET = os.getenv("SESSION_SECRET", "rushwash-whatsapp-auth-secret-key-2026")

# Logs directory
LOGS_DIR = APP_DIR / "logs"
LOGS_DIR.mkdir(parents=True, exist_ok=True)
JSONL_LOG_PATH = LOGS_DIR / "whatsapp_events.jsonl"

# SQLite persistence (WAL). STORAGE_BACKEND=jsonl is the kill-switch back to the legacy JSONL files.
DATA_DIR = APP_DIR / "data"
DB_PATH = Path(os.getenv("UNIFONIC_DB_PATH", str(DATA_DIR / "rush_whatsapp.db")))
STORAGE_BACKEND = os.getenv("STORAGE_BACKEND", "sqlite").strip().lower()
JSONL_MIRROR = os.getenv("JSONL_MIRROR", "1").strip().lower() not in ("0", "false", "no", "off")

# Uploads directory for media hosted directly on VPS
UPLOADS_DIR = APP_DIR / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

# Custom created templates persistence
CUSTOM_TEMPLATES_FILE = APP_DIR / "custom_templates.json"

# Unifonic WhatsApp Pricing & Rates (Default rates per delivered message)
DEFAULT_COST_MARKETING = float(os.getenv("UNIFONIC_COST_MARKETING", "0.15"))
DEFAULT_COST_UTILITY = float(os.getenv("UNIFONIC_COST_UTILITY", "0.04"))
DEFAULT_COST_AUTH = float(os.getenv("UNIFONIC_COST_AUTH", "0.035"))
DEFAULT_COST_SERVICE = float(os.getenv("UNIFONIC_COST_SERVICE", "0.05"))
DEFAULT_CURRENCY = os.getenv("UNIFONIC_CURRENCY", "SAR")
FREE_SERVICE_MESSAGES_MONTHLY_LIMIT = int(os.getenv("FREE_SERVICE_MESSAGES_MONTHLY_LIMIT", "1000"))

