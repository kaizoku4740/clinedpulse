CREATE TABLE IF NOT EXISTS speakers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  institution TEXT NOT NULL DEFAULT '',
  specialty TEXT NOT NULL DEFAULT '',
  faculty_profile_url TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  participation_history TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_speakers_name ON speakers(name);
CREATE INDEX IF NOT EXISTS idx_speakers_specialty ON speakers(specialty);
CREATE INDEX IF NOT EXISTS idx_speakers_institution ON speakers(institution);
