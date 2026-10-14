CREATE TABLE IF NOT EXISTS map_releases (
  id UUID PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  slug VARCHAR(120) NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  visibility VARCHAR(32) NOT NULL CHECK (visibility IN ('public', 'authenticated', 'restricted')),
  status VARCHAR(32) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'publishing', 'published', 'failed', 'archived')),
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  failure_message TEXT
);

CREATE TABLE IF NOT EXISTS map_release_artifacts (
  release_id UUID NOT NULL REFERENCES map_releases(id) ON DELETE CASCADE,
  artifact_id UUID NOT NULL REFERENCES conversion_jobs(id) ON DELETE RESTRICT,
  tile_prefix TEXT,
  tile_format VARCHAR(16),
  bounds JSONB,
  min_zoom SMALLINT,
  max_zoom SMALLINT,
  vector_layers JSONB,
  PRIMARY KEY (release_id, artifact_id)
);

CREATE INDEX IF NOT EXISTS map_releases_publishing_idx ON map_releases(created_at) WHERE status = 'publishing';
