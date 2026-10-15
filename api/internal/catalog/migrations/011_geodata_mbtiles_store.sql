-- GeoData serves new releases directly from its own immutable-MBTiles volume.
-- TileServer remains a compatibility backend only for releases created before
-- this migration; it is no longer in the conversion-to-release critical path.
ALTER TABLE conversion_jobs
  ADD COLUMN IF NOT EXISTS tile_serving_backend VARCHAR(32) NOT NULL DEFAULT 'geodata_mbtiles';

ALTER TABLE conversion_jobs
  DROP CONSTRAINT IF EXISTS conversion_jobs_tile_serving_backend_check;

ALTER TABLE conversion_jobs
  ADD CONSTRAINT conversion_jobs_tile_serving_backend_check
  CHECK (tile_serving_backend IN ('tileserver_cache', 'geodata_mbtiles'));

ALTER TABLE map_release_artifacts
  DROP CONSTRAINT IF EXISTS map_release_artifacts_serving_backend_check;

ALTER TABLE map_release_artifacts
  ADD CONSTRAINT map_release_artifacts_serving_backend_check
  CHECK (serving_backend IN ('object_store', 'tileserver_cache', 'geodata_mbtiles'));

-- Existing converted files were prepared for the old WebGIS TileServer PVC.
-- Re-materialize them into the dedicated GeoData volume. Existing published
-- releases retain their recorded legacy backend until a new version is made.
UPDATE conversion_jobs
SET tile_cache_status = 'pending',
    tile_serving_backend = 'geodata_mbtiles',
    tile_server_dataset = NULL,
    tile_cache_warmed_at = NULL,
    tile_cache_failure = NULL
WHERE status = 'succeeded'
  AND output_object_key IS NOT NULL;
