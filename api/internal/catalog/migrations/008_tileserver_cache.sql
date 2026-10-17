-- A release does not copy every tile into object storage.  Instead it binds an
-- immutable MBTiles artifact to a TileServer dataset after that dataset has
-- been warmed and verified.  Existing releases remain on object_store so this
-- migration is backwards-compatible.
ALTER TABLE map_release_artifacts
  ADD COLUMN IF NOT EXISTS serving_backend VARCHAR(32) NOT NULL DEFAULT 'object_store',
  ADD COLUMN IF NOT EXISTS tile_server_dataset VARCHAR(180),
  ADD COLUMN IF NOT EXISTS warm_status VARCHAR(32) NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS warmed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'map_release_artifacts_serving_backend_check') THEN
    ALTER TABLE map_release_artifacts
      ADD CONSTRAINT map_release_artifacts_serving_backend_check
      CHECK (serving_backend IN ('object_store', 'tileserver_cache'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'map_release_artifacts_warm_status_check') THEN
    ALTER TABLE map_release_artifacts
      ADD CONSTRAINT map_release_artifacts_warm_status_check
      CHECK (warm_status IN ('not_required', 'pending', 'ready', 'failed'));
  END IF;
END $$;
