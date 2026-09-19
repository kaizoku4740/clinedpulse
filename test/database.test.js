import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const dir = mkdtempSync(join(tmpdir(), 'ceos-phase1-'));
process.env.DATABASE_PATH = join(dir, 'test.db');
const { checklistItems, db } = await import('../lib/database.js');
const { detectEmailMaterials, normalizeEmailAddress } = await import('../lib/email-monitoring.js');
const { verifyWebhookSignature } = await import('../lib/webhook-signing.js');

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

test('stores event database records linked to speakers', () => {
  const speaker = db.prepare('INSERT INTO speakers (name,email) VALUES (?,?)').run('Event Speaker', 'event-speaker@example.com');
  const event = db.prepare(`INSERT INTO events
    (event_name,event_type,speaker_id,speaker_name,event_date,event_time,topic,zoom_link,status)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    'ClinEdPulse Test Webinar',
    'Webinar',
    speaker.lastInsertRowid,
    'Event Speaker',
    '2026-07-15',
    '13:00',
    'Testing event operations',
    'https://example.com/zoom',
    'Planning'
  );
  const row = db.prepare('SELECT * FROM events WHERE id=?').get(event.lastInsertRowid);
  assert.equal(row.event_name, 'ClinEdPulse Test Webinar');
  assert.equal(row.speaker_id, speaker.lastInsertRowid);
  assert.equal(row.status, 'Planning');
});

test('speaker history can be derived from linked events', () => {
  const speaker = db.prepare('INSERT INTO speakers (name,email) VALUES (?,?)').run('History Speaker', 'history-speaker@example.com');
  const insertEvent = db.prepare(`INSERT INTO events
    (event_name,event_type,speaker_id,speaker_name,event_date,topic,status)
    VALUES (?,?,?,?,?,?,?)`);
  insertEvent.run(
    'Acute Leukemia Update',
    'Webinar',
    speaker.lastInsertRowid,
    'History Speaker',
    '2025-06-10',
    'Acute Leukemia',
    'Completed'
  );
  insertEvent.run(
    'CAR-T Therapy Discussion',
    'Case Discussion',
    speaker.lastInsertRowid,
    'History Speaker',
    '2026-02-20',
    'CAR-T Therapy',
    'Follow-Up Complete'
  );
  insertEvent.run(
    'Future Planning Session',
    'Webinar',
    speaker.lastInsertRowid,
    'History Speaker',
    '2099-02-20',
    'Future Topic',
    'Planning'
  );
  const rows = db.prepare(`SELECT event_name, event_date, topic
    FROM events
    WHERE speaker_id=?
    AND event_date < date('now')
    ORDER BY event_date DESC`).all(speaker.lastInsertRowid);
  const scheduledRows = db.prepare(`SELECT event_name, event_date, topic
    FROM events
    WHERE speaker_id=?
    AND event_date >= date('now')
    ORDER BY event_date`).all(speaker.lastInsertRowid);
  assert.deepEqual(rows.map(row => row.topic), ['CAR-T Therapy', 'Acute Leukemia']);
  assert.deepEqual(rows.map(row => row.event_date), ['2026-02-20', '2025-06-10']);
  assert.deepEqual(scheduledRows.map(row => row.topic), ['Future Topic']);
});

test('stores the standard operations checklist for events', () => {
  const speaker = db.prepare('INSERT INTO speakers (name,email) VALUES (?,?)').run('Checklist Speaker', 'checklist-speaker@example.com');
  const event = db.prepare(`INSERT INTO events
    (event_name,event_type,speaker_id,speaker_name,event_date,status)
    VALUES (?,?,?,?,?,?)`).run(
    'Checklist Test Webinar',
    'Webinar',
    speaker.lastInsertRowid,
    'Checklist Speaker',
    '2026-08-01',
    'Planning'
  );
  const insert = db.prepare('INSERT INTO event_checklist_items (event_id,label,position) VALUES (?,?,?)');
  checklistItems.forEach((item, index) => insert.run(event.lastInsertRowid, item, index + 1));
  const rows = db.prepare('SELECT label, completed, due_date FROM event_checklist_items WHERE event_id=? ORDER BY position').all(event.lastInsertRowid);
  assert.deepEqual(rows.map(row => row.label), checklistItems);
  assert.equal(rows.every(row => row.completed === 0), true);
  assert.equal(rows.every(row => row.due_date === null), true);
});

test('event readiness score uses weighted checklist items', () => {
  const speaker = db.prepare('INSERT INTO speakers (name,email) VALUES (?,?)').run('Readiness Speaker', 'readiness-speaker@example.com');
  const event = db.prepare(`INSERT INTO events
    (event_name,event_type,speaker_id,speaker_name,event_date,status)
    VALUES (?,?,?,?,?,?)`).run(
    'Readiness Score Webinar',
    'Webinar',
    speaker.lastInsertRowid,
    'Readiness Speaker',
    '2026-10-01',
    'Planning'
  );
  const insert = db.prepare('INSERT INTO event_checklist_items (event_id,label,position,completed) VALUES (?,?,?,?)');
  const completed = new Set(['Speaker Confirmed', 'Slides Received', 'Consent Form Received', 'Marketing Team Notified']);
  checklistItems.forEach((item, index) => insert.run(event.lastInsertRowid, item, index + 1, completed.has(item) ? 1 : 0));
  const score = db.prepare(`SELECT COALESCE(SUM(CASE
    WHEN completed = 1 THEN CASE label
      WHEN 'Speaker Confirmed' THEN 10
      WHEN 'Zoom Created' THEN 10
      WHEN 'Bio Collected' THEN 10
      WHEN 'Headshot Collected' THEN 10
      WHEN 'Topic Finalized' THEN 10
      WHEN 'Slides Requested' THEN 10
      WHEN 'Slides Received' THEN 20
      WHEN 'Consent Form Received' THEN 20
      ELSE 0
    END
    ELSE 0
  END), 0) readiness_score
    FROM event_checklist_items
    WHERE event_id=?`).get(event.lastInsertRowid).readiness_score;
  assert.equal(score, 50);
});

test('event readiness score reaches 100 only when every checklist item is complete', () => {
  const speaker = db.prepare('INSERT INTO speakers (name,email) VALUES (?,?)').run('Complete Readiness Speaker', 'complete-readiness@example.com');
  const event = db.prepare(`INSERT INTO events
    (event_name,event_type,speaker_id,speaker_name,event_date,status)
    VALUES (?,?,?,?,?,?)`).run(
    'Complete Readiness Webinar',
    'Webinar',
    speaker.lastInsertRowid,
    'Complete Readiness Speaker',
    '2026-11-01',
    'Planning'
  );
  const weightedItems = new Set([
    'Speaker Confirmed',
    'Zoom Created',
    'Bio Collected',
    'Headshot Collected',
    'Topic Finalized',
    'Slides Requested',
    'Slides Received',
    'Consent Form Received'
  ]);
  const insert = db.prepare('INSERT INTO event_checklist_items (event_id,label,position,completed) VALUES (?,?,?,?)');
  checklistItems.forEach((item, index) => insert.run(event.lastInsertRowid, item, index + 1, weightedItems.has(item) ? 1 : 0));
  const readinessSql = `SELECT CASE
    WHEN COUNT(id) > 0 AND COUNT(id) = COALESCE(SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END), 0) THEN 100
    ELSE MIN(COALESCE(SUM(CASE
      WHEN completed = 1 THEN CASE label
        WHEN 'Speaker Confirmed' THEN 10
        WHEN 'Zoom Created' THEN 10
        WHEN 'Bio Collected' THEN 10
        WHEN 'Headshot Collected' THEN 10
        WHEN 'Topic Finalized' THEN 10
        WHEN 'Slides Requested' THEN 10
        WHEN 'Slides Received' THEN 20
        WHEN 'Consent Form Received' THEN 20
        ELSE 0
      END
      ELSE 0
    END), 0), 99)
  END readiness_score
    FROM event_checklist_items
    WHERE event_id=?`;
  assert.equal(db.prepare(readinessSql).get(event.lastInsertRowid).readiness_score, 99);
  db.prepare('UPDATE event_checklist_items SET completed=1 WHERE event_id=?').run(event.lastInsertRowid);
  assert.equal(db.prepare(readinessSql).get(event.lastInsertRowid).readiness_score, 100);
});

test('event status can mark related checklist items complete', () => {
  const speaker = db.prepare('INSERT INTO speakers (name,email) VALUES (?,?)').run('Status Speaker', 'status-speaker@example.com');
  const event = db.prepare(`INSERT INTO events
    (event_name,event_type,speaker_id,speaker_name,event_date,status)
    VALUES (?,?,?,?,?,?)`).run(
    'Status Checklist Webinar',
    'Webinar',
    speaker.lastInsertRowid,
    'Status Speaker',
    '2026-09-01',
    'Event Ready'
  );
  const insert = db.prepare('INSERT INTO event_checklist_items (event_id,label,position) VALUES (?,?,?)');
  checklistItems.forEach((item, index) => insert.run(event.lastInsertRowid, item, index + 1));
  const readyItems = [
    'Speaker Confirmed', 'Zoom Created', 'Calendar Invite Sent', 'Bio Collected',
    'Headshot Collected', 'Faculty Profile Added', 'Topic Finalized', 'Slides Requested',
    'Slides Received', 'Consent Form Received', 'Marketing Team Notified'
  ];
  const update = db.prepare('UPDATE event_checklist_items SET completed=1 WHERE event_id=? AND label=?');
  readyItems.forEach(label => update.run(event.lastInsertRowid, label));
  const rows = db.prepare('SELECT label, completed FROM event_checklist_items WHERE event_id=?').all(event.lastInsertRowid);
  assert.equal(rows.filter(row => row.completed === 1).length, readyItems.length);
  assert.equal(rows.find(row => row.label === 'Thank-You Email Sent').completed, 0);
});

test('events can store Calendly metadata without duplicate invitees', () => {
  const speaker = db.prepare('INSERT INTO speakers (name,email) VALUES (?,?)').run('Calendly Speaker', 'calendly-speaker@example.com');
  const insert = db.prepare(`INSERT INTO events
    (event_name,event_type,speaker_id,speaker_name,event_date,event_time,topic,status,calendly_event_uri,calendly_invitee_uri)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  insert.run(
    'Calendly Booked Webinar',
    'Webinar',
    speaker.lastInsertRowid,
    'Calendly Speaker',
    '2026-12-01',
    '10:30',
    'Scheduling automation',
    'Speaker Confirmed',
    'https://api.calendly.com/scheduled_events/test-event',
    'https://api.calendly.com/scheduled_events/test-event/invitees/test-invitee'
  );
  const row = db.prepare('SELECT calendly_event_uri, calendly_invitee_uri FROM events WHERE speaker_id=?').get(speaker.lastInsertRowid);
  assert.equal(row.calendly_event_uri, 'https://api.calendly.com/scheduled_events/test-event');
  assert.throws(() => insert.run(
    'Duplicate Calendly Booked Webinar',
    'Webinar',
    speaker.lastInsertRowid,
    'Calendly Speaker',
    '2026-12-01',
    '10:30',
    'Scheduling automation',
    'Speaker Confirmed',
    'https://api.calendly.com/scheduled_events/test-event',
    'https://api.calendly.com/scheduled_events/test-event/invitees/test-invitee'
  ), /UNIQUE/);
});

test('events cannot be duplicated for the same speaker date and time', () => {
  const speaker = db.prepare('INSERT INTO speakers (name,email) VALUES (?,?)').run('Duplicate Event Speaker', 'duplicate-event@example.com');
  const insert = db.prepare(`INSERT INTO events
    (event_name,event_type,speaker_id,speaker_name,event_date,event_time,topic,status)
    VALUES (?,?,?,?,?,?,?,?)`);
  insert.run(
    'Duplicate Guard Webinar',
    'Webinar',
    speaker.lastInsertRowid,
    'Duplicate Event Speaker',
    '2026-12-15',
    '14:00',
    'Duplicate protection',
    'Planning'
  );
  assert.throws(() => insert.run(
    'Duplicate Guard Webinar',
    'Webinar',
    speaker.lastInsertRowid,
    'Duplicate Event Speaker',
    '2026-12-15',
    '14:00',
    'Duplicate protection',
    'Planning'
  ), /UNIQUE/);
});

test('email monitoring recognizes speaker materials conservatively', () => {
  const materials = detectEmailMaterials({
    subject: 'Faculty materials',
    attachments: [
      { filename: 'clinical-update-slides.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
      { filename: 'Dr-Test-biography.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      { filename: 'signed-consent-form.pdf', mimeType: 'application/pdf' },
      { filename: 'unidentified.pdf', mimeType: 'application/pdf' }
    ]
  });
  assert.deepEqual(materials.map(material => material.label), [
    'Slides Received', 'Bio Collected', 'Consent Form Received'
  ]);
  assert.equal(normalizeEmailAddress('Dr. Test <TEST@example.com>'), 'test@example.com');
});

test('pending email reviews never change a checklist automatically', () => {
  const speaker = db.prepare('INSERT INTO speakers (name,email) VALUES (?,?)').run('Email Review Speaker', 'email-review@example.com');
  const event = db.prepare(`INSERT INTO events
    (event_name,event_type,speaker_id,speaker_name,event_date,status)
    VALUES (?,?,?,?,?,?)`).run('Email Review Webinar', 'Webinar', speaker.lastInsertRowid, 'Email Review Speaker', '2099-08-01', 'Materials Pending');
  const checklist = db.prepare(`INSERT INTO event_checklist_items (event_id,label,position)
    VALUES (?,?,?)`).run(event.lastInsertRowid, 'Slides Received', 9);
  db.prepare(`INSERT INTO email_material_reviews
    (message_key,sender_email,subject,attachment_name,material_type,checklist_label,speaker_id,event_id)
    VALUES (?,?,?,?,?,?,?,?)`).run(
      '<email-review-test@example.com>', 'email-review@example.com', 'Slides attached', 'slides.pptx',
      'slides', 'Slides Received', speaker.lastInsertRowid, event.lastInsertRowid
    );
  const item = db.prepare('SELECT completed,completed_at FROM event_checklist_items WHERE id=?').get(checklist.lastInsertRowid);
  assert.equal(item.completed, 0);
  assert.equal(item.completed_at, null);
  assert.equal(db.prepare('SELECT status FROM email_material_reviews WHERE message_key=?').get('<email-review-test@example.com>').status, 'pending');
});

test('test-mode seed data is isolated from live hub records', () => {
  const testSpeakers = db.prepare("SELECT email FROM speakers WHERE hub_key='test-heme' ORDER BY email").all();
  const liveTestEmails = db.prepare("SELECT email FROM speakers WHERE hub_key='heme' AND email LIKE 'test.heme.%'").all();
  const testEvents = db.prepare("SELECT COUNT(*) count FROM events WHERE hub_key='test-heme'").get().count;
  const testReviews = db.prepare("SELECT COUNT(*) count FROM email_material_reviews WHERE hub_key='test-heme'").get().count;
  assert.equal(testSpeakers.length, 2);
  assert.equal(liveTestEmails.length, 0);
  assert.equal(testEvents, 2);
  assert.equal(testReviews, 1);
});

test('test reset clears live workspaces and expands fictional test data', () => {
  const resetSql = readFileSync(
    new URL('../migrations/0010_clear_live_and_expand_test_data.sql', import.meta.url),
    'utf8'
  );
  db.exec(resetSql);

  const liveSpeakers = db.prepare("SELECT COUNT(*) count FROM speakers WHERE hub_key IN ('heme','endo','gastro')").get().count;
  const liveEvents = db.prepare("SELECT COUNT(*) count FROM events WHERE hub_key IN ('heme','endo','gastro')").get().count;
  const testSpeakers = db.prepare("SELECT COUNT(*) count FROM speakers WHERE hub_key LIKE 'test-%'").get().count;
  const testEvents = db.prepare("SELECT COUNT(*) count FROM events WHERE hub_key LIKE 'test-%'").get().count;
  const pendingReviews = db.prepare("SELECT COUNT(*) count FROM email_material_reviews WHERE hub_key LIKE 'test-%' AND status='pending'").get().count;

  assert.equal(liveSpeakers, 0);
  assert.equal(liveEvents, 0);
  assert.equal(testSpeakers, 18);
  assert.equal(testEvents, 24);
  assert.equal(pendingReviews, 9);
});

test('Gmail ingestion signatures are verified and expire quickly', async () => {
  const secret = 'unit-test-secret';
  const timestamp = '1784570400';
  const body = JSON.stringify({ message_key: 'gmail:test-message' });
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  const now = Number(timestamp) * 1000;
  assert.equal((await verifyWebhookSignature({ secret, timestamp, signature, body, now })).ok, true);
  assert.equal((await verifyWebhookSignature({ secret, timestamp, signature: `00${signature.slice(2)}`, body, now })).ok, false);
  assert.equal((await verifyWebhookSignature({ secret, timestamp, signature, body, now: now + 6 * 60 * 1000 })).reason, 'expired');
});
