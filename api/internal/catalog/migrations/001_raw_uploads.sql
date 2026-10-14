CREATE TABLE IF NOT EXISTS raw_uploads (
  id UUID PRIMARY KEY,
  display_name VARCHAR(200) NOT NULL,
  data_type VARCHAR(32) NOT NULL CHECK (data_type IN (
    'street', 'satellite', 'administrative', 'topographic', 'land_use', 'hydrology', 'other'
  )),
  source_file_name VARCHAR(255) NOT NULL,
  source_format VARCHAR(32) NOT NULL CHECK (source_format IN (
    'osm_pbf', 'geotiff', 'geopackage', 'shapefile_zip', 'mbtiles'
  )),
  raw_object_key TEXT NOT NULL UNIQUE,
  byte_size BIGINT NOT NULL CHECK (byte_size > 0),
  sha256 CHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'rejected', 'archived')),
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS raw_uploads_created_at_idx ON raw_uploads (created_at DESC);
CREATE INDEX IF NOT EXISTS raw_uploads_data_type_idx ON raw_uploads (data_type);
