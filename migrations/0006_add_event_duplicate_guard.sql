CREATE UNIQUE INDEX IF NOT EXISTS idx_events_duplicate_guard
  ON events(lower(event_name), speaker_id, event_date, COALESCE(event_time, ''));
