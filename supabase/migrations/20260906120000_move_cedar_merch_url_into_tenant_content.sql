-- Move Camp Cedar's merch shop URL out of the code and into its own settings.
--
-- `useMemberNav.js` used to fall back to https://thecampspot.com/camphome.aspx
-- for any tenant whose slug happened to be 'cedar' or 'camp-cedar'. That put one
-- camp's commerce vendor into the product for anyone who took that slug, and it
-- meant Cedar's own store link lived in a source file rather than in the
-- settings screen its director can edit.
--
-- The code now reads content->>'merchShopUrl' and nothing else, so this writes
-- the value Cedar has been getting from the fallback into the place the code
-- reads. Without it, merging that change removes the Merch Shop item from
-- Cedar's member menu.
--
-- Scoped to tenants that are actually relying on the fallback: the two slugs the
-- old condition matched, and only where no URL has been configured. Any camp
-- that set its own is left alone.
UPDATE public.tenants
SET content = jsonb_set(
      COALESCE(content, '{}'::jsonb),
      '{merchShopUrl}',
      to_jsonb('https://thecampspot.com/camphome.aspx'::text),
      true
    )
WHERE slug IN ('cedar', 'camp-cedar')
  AND COALESCE(NULLIF(TRIM(content->>'merchShopUrl'), ''), '') = '';
