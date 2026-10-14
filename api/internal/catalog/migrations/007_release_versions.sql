ALTER TABLE map_releases ADD COLUMN IF NOT EXISTS map_code VARCHAR(120);
ALTER TABLE map_releases ADD COLUMN IF NOT EXISTS version VARCHAR(32);
ALTER TABLE map_releases ADD COLUMN IF NOT EXISTS release_notes TEXT NOT NULL DEFAULT '';

-- Releases created before version management each become version 1.0.0 of a
-- logical map identified by their previous URL slug. This preserves every
-- published URL while allowing new releases to use a stable generated code.
UPDATE map_releases SET map_code = slug WHERE map_code IS NULL OR map_code = '';
UPDATE map_releases SET version = '1.0.0' WHERE version IS NULL OR version = '';

ALTER TABLE map_releases ALTER COLUMN map_code SET NOT NULL;
ALTER TABLE map_releases ALTER COLUMN version SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS map_releases_map_code_version_unique
  ON map_releases(map_code, version);
CREATE INDEX IF NOT EXISTS map_releases_map_code_updated_idx
  ON map_releases(map_code, updated_at DESC);
