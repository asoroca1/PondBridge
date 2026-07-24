BEGIN;

-- Tenant-scoped member blocks. The API enforces reciprocal visibility and
-- direct-message restrictions; this trigger prevents accidental cross-camp
-- records even when the service role performs the write.
CREATE TABLE IF NOT EXISTS public.member_blocks (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  blocker_user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  blocked_user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (blocker_user_id <> blocked_user_id),
  UNIQUE (tenant_id, blocker_user_id, blocked_user_id)
);

CREATE INDEX IF NOT EXISTS idx_member_blocks_tenant_blocker
  ON public.member_blocks (tenant_id, blocker_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_member_blocks_tenant_blocked
  ON public.member_blocks (tenant_id, blocked_user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.enforce_member_block_tenant_consistency()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = NEW.blocker_user_id AND tenant_id = NEW.tenant_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = NEW.blocked_user_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Member block users must belong to the block tenant';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = pg_catalog, public;

DROP TRIGGER IF EXISTS trigger_enforce_member_block_tenant_consistency ON public.member_blocks;
CREATE TRIGGER trigger_enforce_member_block_tenant_consistency
BEFORE INSERT OR UPDATE OF tenant_id, blocker_user_id, blocked_user_id ON public.member_blocks
FOR EACH ROW EXECUTE FUNCTION public.enforce_member_block_tenant_consistency();

-- Reports store only the moderation record and references to existing content.
-- Every user reference is verified against the report tenant before the row is
-- accepted.
CREATE TABLE IF NOT EXISTS public.content_reports (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  reporter_user_id text REFERENCES public.users(id) ON DELETE SET NULL,
  target_type text NOT NULL CHECK (
    target_type IN ('member', 'message', 'forum', 'forum_post', 'photo', 'photo_comment')
  ),
  target_id text NOT NULL,
  target_author_user_id text REFERENCES public.users(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (
    reason IN ('harassment', 'spam', 'privacy', 'impersonation', 'inappropriate', 'safety', 'other')
  ),
  details text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
  resolution_note text NOT NULL DEFAULT '',
  reviewed_by_user_id text REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_reports_tenant_status
  ON public.content_reports (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_reports_tenant_target
  ON public.content_reports (tenant_id, target_type, target_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_content_reports_active_dedup
  ON public.content_reports (tenant_id, reporter_user_id, target_type, target_id)
  WHERE status IN ('open', 'reviewing');

CREATE OR REPLACE FUNCTION public.enforce_content_report_tenant_consistency()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.reporter_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = NEW.reporter_user_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Content report reporter must belong to the report tenant';
  END IF;
  IF NEW.target_author_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = NEW.target_author_user_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Content report target author must belong to the report tenant';
  END IF;
  IF NEW.reviewed_by_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = NEW.reviewed_by_user_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Content report reviewer must belong to the report tenant';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = pg_catalog, public;

DROP TRIGGER IF EXISTS trigger_enforce_content_report_tenant_consistency ON public.content_reports;
CREATE TRIGGER trigger_enforce_content_report_tenant_consistency
BEFORE INSERT OR UPDATE OF tenant_id, reporter_user_id, target_author_user_id, reviewed_by_user_id
ON public.content_reports
FOR EACH ROW EXECUTE FUNCTION public.enforce_content_report_tenant_consistency();

CREATE OR REPLACE FUNCTION public.trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = pg_catalog;

DROP TRIGGER IF EXISTS set_updated_at ON public.member_blocks;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.member_blocks
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.content_reports;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.content_reports
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

ALTER TABLE public.member_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_blocks FORCE ROW LEVEL SECURITY;
ALTER TABLE public.content_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_reports FORCE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.member_blocks, public.content_reports
  TO service_role;
REVOKE ALL
  ON public.member_blocks, public.content_reports
  FROM anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'member_blocks'
      AND policyname = 'member_blocks_service_role_all'
  ) THEN
    CREATE POLICY member_blocks_service_role_all
      ON public.member_blocks FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'content_reports'
      AND policyname = 'content_reports_service_role_all'
  ) THEN
    CREATE POLICY content_reports_service_role_all
      ON public.content_reports FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END;
$$;

COMMIT;
