ALTER TABLE speakers ADD COLUMN expertise TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS event_speakers (
  event_id INTEGER NOT NULL,
  speaker_id INTEGER NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id, speaker_id),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (speaker_id) REFERENCES speakers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_event_speakers_speaker
  ON event_speakers(speaker_id, event_id);

INSERT OR IGNORE INTO event_speakers (event_id, speaker_id, position)
SELECT id, speaker_id, 0
FROM events
WHERE speaker_id IS NOT NULL;
