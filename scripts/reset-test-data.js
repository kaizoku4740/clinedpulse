import { readFileSync } from 'node:fs';

import { db } from '../lib/database.js';

const resetSql = readFileSync(
  new URL('../migrations/0010_clear_live_and_expand_test_data.sql', import.meta.url),
  'utf8'
);

db.exec('BEGIN IMMEDIATE');
try {
  db.exec(resetSql);
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}

const liveSpeakers = db.prepare(
  "SELECT COUNT(*) AS count FROM speakers WHERE hub_key IN ('heme','endo','gastro')"
).get().count;
const liveEvents = db.prepare(
  "SELECT COUNT(*) AS count FROM events WHERE hub_key IN ('heme','endo','gastro')"
).get().count;
const testSpeakers = db.prepare(
  "SELECT COUNT(*) AS count FROM speakers WHERE hub_key IN ('test-heme','test-endo','test-gastro')"
).get().count;
const testEvents = db.prepare(
  "SELECT COUNT(*) AS count FROM events WHERE hub_key IN ('test-heme','test-endo','test-gastro')"
).get().count;
const pendingReviews = db.prepare(
  "SELECT COUNT(*) AS count FROM email_material_reviews WHERE hub_key LIKE 'test-%' AND status='pending'"
).get().count;

console.log('Live workspaces cleared.');
console.log(`Live records: ${liveSpeakers} speakers, ${liveEvents} events`);
console.log(`Test records: ${testSpeakers} speakers, ${testEvents} events`);
console.log(`Pending test email reviews: ${pendingReviews}`);
