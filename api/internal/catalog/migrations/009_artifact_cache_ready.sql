-- Warm MBTiles as soon as conversion succeeds. Publication can then be an
-- inexpensive catalog transition, instead of a second full-object transfer.
ALTER TABLE conversion_jobs
  ADD COLUMN IF NOT EXISTS tile_cache_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS tile_server_dataset VARCHAR(180),
  ADD COLUMN IF NOT EXISTS tile_format VARCHAR(16),
  ADD COLUMN IF NOT EXISTS tile_bounds JSONB,
  ADD COLUMN IF NOT EXISTS tile_vector_layers JSONB,
  ADD COLUMN IF NOT EXISTS tile_cache_warmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tile_cache_failure TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversion_jobs_tile_cache_status_check') THEN
    ALTER TABLE conversion_jobs ADD CONSTRAINT conversion_jobs_tile_cache_status_check
      CHECK (tile_cache_status IN ('pending', 'warming', 'ready', 'failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS conversion_jobs_tile_cache_pending_idx
  ON conversion_jobs(created_at) WHERE status = 'succeeded' AND tile_cache_status = 'pending';
