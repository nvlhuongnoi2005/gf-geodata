-- Access policy is configured after publication: either public, or named
-- WebGIS users/organisations. Public access has a single canonical principal.
ALTER TABLE access_grants
  DROP CONSTRAINT IF EXISTS access_grants_principal_type_check;

ALTER TABLE access_grants
  ADD CONSTRAINT access_grants_principal_type_check
  CHECK (principal_type IN ('user', 'organization', 'public'));

ALTER TABLE access_grants
  DROP CONSTRAINT IF EXISTS access_grants_public_principal_check;

ALTER TABLE access_grants
  ADD CONSTRAINT access_grants_public_principal_check
  CHECK (principal_type <> 'public' OR principal_id = '*');

-- The old authenticated policy had no UI equivalent in the new two-option
-- model. Treat it as restricted, which is the safe default.
UPDATE map_releases SET visibility='restricted' WHERE visibility='authenticated';

-- A failed warm can be caused by a transient TileServer restart/configuration
-- issue. Retain the error but retry it after a short backoff.
ALTER TABLE conversion_jobs
  ADD COLUMN IF NOT EXISTS tile_cache_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tile_cache_last_attempt_at TIMESTAMPTZ;

ALTER TABLE conversion_jobs
  DROP COLUMN IF EXISTS estimated_duration_seconds;
