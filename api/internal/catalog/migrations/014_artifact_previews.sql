-- A preview belongs to the immutable conversion artifact, not a release. One
-- rendered image can therefore be reused by multiple release versions while
-- the gateway applies each release's ACL when it serves the image.
ALTER TABLE conversion_jobs
  ADD COLUMN IF NOT EXISTS preview_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS preview_object_key TEXT,
  ADD COLUMN IF NOT EXISTS preview_failure TEXT,
  ADD COLUMN IF NOT EXISTS preview_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS preview_updated_at TIMESTAMPTZ;

ALTER TABLE conversion_jobs
  DROP CONSTRAINT IF EXISTS conversion_jobs_preview_status_check;

ALTER TABLE conversion_jobs
  ADD CONSTRAINT conversion_jobs_preview_status_check
  CHECK (preview_status IN ('pending', 'rendering', 'ready', 'failed'));

-- Backfill all ready artifacts so the new worker produces thumbnails for
-- releases created before this migration as well.
UPDATE conversion_jobs
SET preview_status='pending', preview_object_key=NULL, preview_failure=NULL
WHERE status='succeeded'
  AND output_object_key IS NOT NULL
  AND tile_cache_status='ready'
  AND preview_status<>'ready';

CREATE INDEX IF NOT EXISTS conversion_jobs_preview_pending_idx
  ON conversion_jobs(created_at)
  WHERE status='succeeded' AND tile_cache_status='ready' AND preview_status='pending';
