import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dataDir = join(root, 'data');
mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(process.env.DATABASE_PATH || join(dataDir, 'ceos.db'));
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');
export const checklistItems = [
  'Speaker Confirmed',
  'Zoom Created',
  'Calendar Invite Sent',
  'Bio Collected',
  'Headshot Collected',
  'Faculty Profile Added',
  'Topic Finalized',
  'Slides Requested',
  'Slides Received',
  'Consent Form Received',
  'Marketing Team Notified',
  'Thank-You Email Sent'
];
db.exec(`
  CREATE TABLE IF NOT EXISTS speakers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    institution TEXT NOT NULL DEFAULT '',
    specialty TEXT NOT NULL DEFAULT '',
    faculty_profile_url TEXT NOT NULL DEFAULT '',
    profile_picture_url TEXT NOT NULL DEFAULT '',
    bio TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    participation_history TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

// Allows databases created by the earlier prototype to upgrade in place.
const columns = db.prepare('PRAGMA table_info(speakers)').all().map(column => column.name);
if (!columns.includes('participation_history')) {
  db.exec("ALTER TABLE speakers ADD COLUMN participation_history TEXT NOT NULL DEFAULT ''");
}
if (!columns.includes('hub_key')) {
  db.exec("ALTER TABLE speakers ADD COLUMN hub_key TEXT NOT NULL DEFAULT 'heme'");
}

function createEventsTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_name TEXT NOT NULL,
      event_type TEXT NOT NULL,
      speaker_id INTEGER,
      speaker_name TEXT NOT NULL DEFAULT '',
      event_date TEXT NOT NULL,
      event_time TEXT NOT NULL DEFAULT '',
      topic TEXT NOT NULL DEFAULT '',
      zoom_link TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      calendly_event_uri TEXT NOT NULL DEFAULT '',
      calendly_invitee_uri TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (speaker_id) REFERENCES speakers(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
    CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
  `);
}

function createChecklistTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_checklist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      label TEXT NOT NULL,
      position INTEGER NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      due_date TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
      UNIQUE(event_id, label)
    );

    CREATE INDEX IF NOT EXISTS idx_event_checklist_event ON event_checklist_items(event_id);
  `);
}

function backfillEventChecklists() {
  const statement = db.prepare(`INSERT OR IGNORE INTO event_checklist_items (event_id,label,position)
    SELECT id, ?, ? FROM events`);
  checklistItems.forEach((item, index) => {
    statement.run(item, index + 1);
  });
}

const eventColumns = db.prepare('PRAGMA table_info(events)').all().map(column => column.name);
if (eventColumns.length && !eventColumns.includes('event_name')) {
  const legacyTable = `events_legacy_${Date.now()}`;
  db.exec(`ALTER TABLE events RENAME TO ${legacyTable}`);
  createEventsTable();
  db.exec(`
    INSERT INTO events (id,event_name,event_type,speaker_id,speaker_name,event_date,event_time,topic,zoom_link,status,created_at,updated_at)
    SELECT legacy.id, legacy.name, legacy.type, legacy.speaker_id, COALESCE(speakers.name, ''),
      substr(legacy.starts_at, 1, 10), substr(legacy.starts_at, 12, 5), legacy.topic, legacy.zoom_link,
      legacy.status, legacy.created_at, legacy.updated_at
    FROM ${legacyTable} legacy
    LEFT JOIN speakers ON speakers.id = legacy.speaker_id
  `);
} else {
  createEventsTable();
}

const currentEventColumns = db.prepare('PRAGMA table_info(events)').all().map(column => column.name);
if (!currentEventColumns.includes('calendly_event_uri')) {
  db.exec("ALTER TABLE events ADD COLUMN calendly_event_uri TEXT NOT NULL DEFAULT ''");
}
if (!currentEventColumns.includes('calendly_invitee_uri')) {
  db.exec("ALTER TABLE events ADD COLUMN calendly_invitee_uri TEXT NOT NULL DEFAULT ''");
}
if (!currentEventColumns.includes('hub_key')) {
  db.exec("ALTER TABLE events ADD COLUMN hub_key TEXT NOT NULL DEFAULT 'heme'");
}
db.exec('CREATE INDEX IF NOT EXISTS idx_speakers_hub ON speakers(hub_key)');
db.exec('CREATE INDEX IF NOT EXISTS idx_events_hub ON events(hub_key)');
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_events_calendly_invitee_uri
  ON events(calendly_invitee_uri)
  WHERE calendly_invitee_uri != ''`);
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_events_duplicate_guard
  ON events(lower(event_name), speaker_id, event_date, COALESCE(event_time, ''))`);

createChecklistTable();
const checklistColumns = db.prepare('PRAGMA table_info(event_checklist_items)').all().map(column => column.name);
if (!checklistColumns.includes('due_date')) {
  db.exec('ALTER TABLE event_checklist_items ADD COLUMN due_date TEXT');
}
backfillEventChecklists();

db.exec(`
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
`);

// Keep the local Node server aligned with the D1 migration. The seed is
// idempotent and uses isolated test-* hub keys, so it never appears in live mode.
db.exec(readFileSync(join(root, 'migrations', '0009_seed_test_mode_workspaces.sql'), 'utf8'));
