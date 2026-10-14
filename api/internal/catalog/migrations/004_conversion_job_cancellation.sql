-- At most one worker-visible conversion may own a raw source at a time.
CREATE UNIQUE INDEX IF NOT EXISTS conversion_jobs_one_active_per_raw_upload_idx
  ON conversion_jobs (raw_upload_id)
  WHERE status IN ('queued', 'running');
