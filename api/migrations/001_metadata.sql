CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS datasets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dataset_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID NOT NULL REFERENCES datasets(id),
  version VARCHAR(80) NOT NULL,
  format VARCHAR(30) NOT NULL CHECK (format IN ('osm_pbf', 'geotiff', 'geopackage', 'shapefile_zip', 'mbtiles')),
  source_file_name VARCHAR(255) NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size > 0),
  expected_sha256 CHAR(64),
  sha256 CHAR(64),
  source_license VARCHAR(300),
  status VARCHAR(30) NOT NULL DEFAULT 'awaiting_upload'
    CHECK (status IN ('awaiting_upload', 'uploading', 'validating', 'ready', 'rejected', 'archived')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  validation JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (dataset_id, version)
);

CREATE INDEX IF NOT EXISTS datasets_active_created_idx ON datasets (status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS dataset_versions_dataset_created_idx ON dataset_versions (dataset_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS upload_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_version_id UUID NOT NULL UNIQUE REFERENCES dataset_versions(id),
  provider_upload_id TEXT NOT NULL UNIQUE,
  staging_key TEXT NOT NULL UNIQUE,
  part_size INTEGER NOT NULL CHECK (part_size >= 5242880),
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'aborted', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
