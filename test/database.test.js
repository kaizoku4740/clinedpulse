import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const dir = mkdtempSync(join(tmpdir(), 'ceos-phase1-'));
process.env.DATABASE_PATH = join(dir, 'test.db');
const { db } = await import('../lib/database.js');

test.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

test('stores a complete placeholder speaker profile', () => {
  const result = db.prepare(`INSERT INTO speakers
    (name,email,institution,specialty,participation_history,notes)
    VALUES (?,?,?,?,?,?)`).run('Dr. Test Person', 'test@example.com', 'Example Hospital', 'Oncology', 'Sample webinar', 'Placeholder only');
  const speaker = db.prepare('SELECT * FROM speakers WHERE id=?').get(result.lastInsertRowid);
  assert.equal(speaker.name, 'Dr. Test Person');
  assert.equal(speaker.participation_history, 'Sample webinar');
});

test('speaker emails are unique regardless of case', () => {
  assert.throws(() => db.prepare('INSERT INTO speakers (name,email) VALUES (?,?)').run('Duplicate', 'TEST@example.com'), /UNIQUE/);
});

test('speaker records can be deleted', () => {
  const result = db.prepare('INSERT INTO speakers (name,email) VALUES (?,?)').run('Delete Me', 'delete@example.com');
  const deletion = db.prepare('DELETE FROM speakers WHERE id=?').run(result.lastInsertRowid);
  assert.equal(deletion.changes, 1);
  assert.equal(db.prepare('SELECT * FROM speakers WHERE id=?').get(result.lastInsertRowid), undefined);
});
