-- A style is immutable once stored.  Releases reference a version instead of
-- embedding style JSON, so a later edit can never alter an already published
-- map. Sprite/glyph files live under the private derived-object prefix named
-- by the style ID and are only exposed through the tile gateway.
CREATE TABLE IF NOT EXISTS style_versions (
  id UUID PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  document JSONB NOT NULL,
  has_sprite BOOLEAN NOT NULL DEFAULT FALSE,
  has_glyphs BOOLEAN NOT NULL DEFAULT FALSE,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE map_releases
  ADD COLUMN IF NOT EXISTS style_version_id UUID REFERENCES style_versions(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS map_releases_style_version_idx
  ON map_releases(style_version_id) WHERE style_version_id IS NOT NULL;
