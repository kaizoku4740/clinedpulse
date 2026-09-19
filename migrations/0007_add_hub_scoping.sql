ALTER TABLE speakers ADD COLUMN hub_key TEXT NOT NULL DEFAULT 'heme';
ALTER TABLE events ADD COLUMN hub_key TEXT NOT NULL DEFAULT 'heme';

CREATE INDEX IF NOT EXISTS idx_speakers_hub ON speakers(hub_key);
CREATE INDEX IF NOT EXISTS idx_events_hub ON events(hub_key);
