-- Defense in depth: client grants are already revoked; service-role API access is retained.
ALTER TABLE public.member_access_tiers ENABLE ROW LEVEL SECURITY;
