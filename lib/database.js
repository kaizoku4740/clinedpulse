import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dataDir = join(root, 'data');
mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(process.env.DATABASE_PATH || join(dataDir, 'ceos.db'));
db.exec('PRAGMA journal_mode = WAL;');
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
