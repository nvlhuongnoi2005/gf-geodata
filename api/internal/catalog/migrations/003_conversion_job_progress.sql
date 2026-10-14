ALTER TABLE conversion_jobs
  ADD COLUMN IF NOT EXISTS progress SMALLINT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS current_step VARCHAR(32) NOT NULL DEFAULT 'queued',
  ADD COLUMN IF NOT EXISTS estimated_duration_seconds INTEGER CHECK (estimated_duration_seconds IS NULL OR estimated_duration_seconds > 0);

UPDATE conversion_jobs
SET progress = CASE
  WHEN status = 'queued' THEN 0
  WHEN status = 'running' THEN 20
  WHEN status = 'succeeded' THEN 100
  ELSE progress
END,
current_step = CASE
  WHEN status = 'queued' THEN 'queued'
  WHEN status = 'running' THEN 'converting'
  WHEN status = 'succeeded' THEN 'succeeded'
  WHEN status = 'failed' THEN 'failed'
  WHEN status = 'canceled' THEN 'canceled'
  ELSE current_step
END;
