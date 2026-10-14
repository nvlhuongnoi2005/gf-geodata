CREATE TABLE IF NOT EXISTS access_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_type VARCHAR(32) NOT NULL CHECK (principal_type IN ('user', 'organization')),
  principal_id TEXT NOT NULL,
  release_id UUID NOT NULL REFERENCES map_releases(id) ON DELETE CASCADE,
  scope VARCHAR(16) NOT NULL CHECK (scope IN ('view', 'export')),
  note TEXT NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_by TEXT,
  revoked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS access_grants_active_unique
  ON access_grants(principal_type, principal_id, release_id, scope)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS access_grants_release_active_idx
  ON access_grants(release_id, principal_type, principal_id)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS access_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action VARCHAR(32) NOT NULL CHECK (action IN ('grant_created', 'grant_revoked')),
  grant_id UUID NOT NULL REFERENCES access_grants(id) ON DELETE CASCADE,
  actor_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS access_audit_events_created_idx ON access_audit_events(created_at DESC);
