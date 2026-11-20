-- Cloudflare D1 Migration: 0001_complaints.sql
-- RUSH Car Wash (رش واش) Customer Complaints & Claims Database Schema

CREATE TABLE IF NOT EXISTS complaints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_code TEXT NOT NULL UNIQUE,          -- Format: C-2026-XXXX
    phone TEXT NOT NULL,
    vehicle_plate TEXT NOT NULL,               -- e.g. "أ ب ج 1234"
    normalized_plate TEXT NOT NULL,            -- e.g. "1234-ABJ"
    branch TEXT NOT NULL DEFAULT 'al-kharj',   -- "al-kharj" | "watan"
    bay TEXT,                                  -- e.g. "tunnel-1"
    category TEXT NOT NULL,                    -- "damage" | "quality" | "billing" | "delay" | "staff"
    affected_parts TEXT,                       -- JSON array e.g. ["hood_bumper", "windshield"]
    description TEXT NOT NULL,
    wash_id TEXT,                              -- Matched ID from rushwash_wash_histories
    order_id TEXT,                             -- Matched ID from rushwash_sale_orders
    wash_details TEXT,                         -- JSON snapshot of matched wash/order details
    status TEXT NOT NULL DEFAULT 'new',        -- "new" | "in_review" | "investigating" | "resolved" | "rejected"
    severity TEXT NOT NULL DEFAULT 'normal',   -- "low" | "normal" | "high" | "urgent"
    chatwoot_conversation_id INTEGER,
    chatwoot_contact_id INTEGER,
    resolution_type TEXT,                      -- "rewash" | "refund" | "rejected" | "none"
    resolution_notes TEXT,
    resolved_at TEXT,                          -- Riyadh AST timestamp
    created_at_ast TEXT NOT NULL,              -- Riyadh AST timestamp (UTC+3)
    created_at INTEGER NOT NULL,               -- Unix epoch (ms)
    updated_at INTEGER NOT NULL                -- Unix epoch (ms)
);

CREATE INDEX IF NOT EXISTS idx_complaints_ticket_code ON complaints(ticket_code);
CREATE INDEX IF NOT EXISTS idx_complaints_phone ON complaints(phone);
CREATE INDEX IF NOT EXISTS idx_complaints_normalized_plate ON complaints(normalized_plate);
CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status);
CREATE INDEX IF NOT EXISTS idx_complaints_wash_id ON complaints(wash_id);

CREATE TABLE IF NOT EXISTS complaint_evidence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    complaint_id INTEGER NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
    file_key TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_type TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    r2_url TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_evidence_complaint_id ON complaint_evidence(complaint_id);

CREATE TABLE IF NOT EXISTS complaint_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    complaint_id INTEGER NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
    author TEXT NOT NULL,                      -- "customer" | "staff" | "system"
    author_name TEXT,
    note_text TEXT NOT NULL,
    is_private INTEGER NOT NULL DEFAULT 0,     -- 1 for staff-only, 0 for customer visible
    created_at_ast TEXT NOT NULL,              -- Riyadh AST timestamp
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notes_complaint_id ON complaint_notes(complaint_id);

CREATE TABLE IF NOT EXISTS complaint_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    complaint_id INTEGER NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
    action TEXT NOT NULL,                      -- "created" | "status_changed" | "note_added" | "resolved"
    changed_by TEXT NOT NULL,
    old_status TEXT,
    new_status TEXT,
    details TEXT,                              -- JSON metadata
    created_at_ast TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_complaint_id ON complaint_audit_log(complaint_id);
