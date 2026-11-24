-- Enable PostgreSQL Row-Level Security (RLS) on all public tables
-- Prevents PostgREST (anon / authenticated) from reading or mutating CRM data directly.
-- The Express backend connects via the privileged Prisma role, which bypasses RLS safely.

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'SystemConfig',
    'StaffUser',
    'AuditLog',
    'Customer',
    'WashVisit',
    'PosOrder',
    'OtpSession',
    'Complaint',
    'Message',
    '_prisma_migrations'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon;', t);
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated;', t);
      END IF;
    END IF;
  END LOOP;
END $$;
