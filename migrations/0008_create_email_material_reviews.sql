CREATE TABLE IF NOT EXISTS email_material_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_key TEXT NOT NULL,
  sender_email TEXT NOT NULL,
  recipient_email TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  attachment_name TEXT NOT NULL DEFAULT '',
  material_type TEXT NOT NULL CHECK (material_type IN ('slides', 'biography', 'consent_form')),
  checklist_label TEXT NOT NULL,
  speaker_id INTEGER,
  event_id INTEGER,
  hub_key TEXT NOT NULL DEFAULT 'heme',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'received', 'ignored')),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (speaker_id) REFERENCES speakers(id) ON DELETE SET NULL,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL,
  UNIQUE(message_key, material_type)
);

CREATE INDEX IF NOT EXISTS idx_email_material_reviews_status
  ON email_material_reviews(hub_key, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_material_reviews_speaker
  ON email_material_reviews(speaker_id);
