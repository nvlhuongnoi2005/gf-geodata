ALTER TABLE raw_uploads DROP CONSTRAINT IF EXISTS raw_uploads_status_check;
ALTER TABLE raw_uploads ADD CONSTRAINT raw_uploads_status_check CHECK (status IN (
  'uploaded', 'converting', 'converted', 'failed', 'rejected', 'archived'
));

CREATE TABLE IF NOT EXISTS conversion_jobs (
  id UUID PRIMARY KEY,
  raw_upload_id UUID NOT NULL REFERENCES raw_uploads(id) ON DELETE RESTRICT,
  status VARCHAR(32) NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued', 'running', 'succeeded', 'failed', 'canceled'
  )),
  min_zoom SMALLINT NOT NULL CHECK (min_zoom BETWEEN 0 AND 24),
  max_zoom SMALLINT NOT NULL CHECK (max_zoom BETWEEN min_zoom AND 24),
  layer_name VARCHAR(120),
  output_object_key TEXT UNIQUE,
  failure_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS conversion_jobs_queue_idx ON conversion_jobs (created_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS conversion_jobs_raw_upload_idx ON conversion_jobs (raw_upload_id, created_at DESC);
