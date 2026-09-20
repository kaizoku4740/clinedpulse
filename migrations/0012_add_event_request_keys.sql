ALTER TABLE events ADD COLUMN request_key TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_request_key
  ON events(hub_key, request_key)
  WHERE request_key != '';
