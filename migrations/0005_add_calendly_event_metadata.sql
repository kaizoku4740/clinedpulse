ALTER TABLE events ADD COLUMN calendly_event_uri TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN calendly_invitee_uri TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_calendly_invitee_uri
  ON events(calendly_invitee_uri)
  WHERE calendly_invitee_uri != '';
