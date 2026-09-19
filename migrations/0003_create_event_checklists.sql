CREATE TABLE IF NOT EXISTS event_checklist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  label TEXT NOT NULL,
  position INTEGER NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  UNIQUE(event_id, label)
);

CREATE INDEX IF NOT EXISTS idx_event_checklist_event ON event_checklist_items(event_id);

INSERT OR IGNORE INTO event_checklist_items (event_id,label,position)
SELECT id, 'Speaker Confirmed', 1 FROM events;
INSERT OR IGNORE INTO event_checklist_items (event_id,label,position)
SELECT id, 'Zoom Created', 2 FROM events;
INSERT OR IGNORE INTO event_checklist_items (event_id,label,position)
SELECT id, 'Calendar Invite Sent', 3 FROM events;
INSERT OR IGNORE INTO event_checklist_items (event_id,label,position)
SELECT id, 'Bio Collected', 4 FROM events;
INSERT OR IGNORE INTO event_checklist_items (event_id,label,position)
SELECT id, 'Headshot Collected', 5 FROM events;
INSERT OR IGNORE INTO event_checklist_items (event_id,label,position)
SELECT id, 'Faculty Profile Added', 6 FROM events;
INSERT OR IGNORE INTO event_checklist_items (event_id,label,position)
SELECT id, 'Topic Finalized', 7 FROM events;
INSERT OR IGNORE INTO event_checklist_items (event_id,label,position)
SELECT id, 'Slides Requested', 8 FROM events;
INSERT OR IGNORE INTO event_checklist_items (event_id,label,position)
SELECT id, 'Slides Received', 9 FROM events;
INSERT OR IGNORE INTO event_checklist_items (event_id,label,position)
SELECT id, 'Consent Form Received', 10 FROM events;
INSERT OR IGNORE INTO event_checklist_items (event_id,label,position)
SELECT id, 'Marketing Team Notified', 11 FROM events;
INSERT OR IGNORE INTO event_checklist_items (event_id,label,position)
SELECT id, 'Thank-You Email Sent', 12 FROM events;
