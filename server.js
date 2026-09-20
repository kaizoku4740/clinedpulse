import http from 'node:http';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checklistItems, db } from './lib/database.js';
import { detectEmailMaterials, materialNotificationTitle, normalizeEmailAddress } from './lib/email-monitoring.js';
import { verifyWebhookSignature } from './lib/webhook-signing.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicDir = join(root, 'public');
const port = Number(process.env.PORT || 3000);
const hubKey = value => ['heme', 'endo', 'gastro'].includes(value) ? value : 'heme';
const storageHubKey = (hub, mode = 'live') => mode === 'test' ? `test-${hubKey(hub)}` : hubKey(hub);

const json = (res, status, data) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
};

const readBody = async req => {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw Object.assign(new Error('Request too large'), { status: 413 });
  }
  return raw;
};

const parseJson = raw => {
  if (!raw) return {};
  try { return JSON.parse(raw); }
  catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
};
const parseBody = async req => parseJson(await readBody(req));

const publicSpeaker = speaker => speaker ? ({
  ...speaker,
  email: /^missing-email-[^@]+@clinedpulse\.invalid$/i.test(speaker.email || '') ? '' : speaker.email
}) : speaker;
const getSpeaker = id => publicSpeaker(db.prepare('SELECT * FROM speakers WHERE id = ?').get(id));
const getSpeakerPastEvents = id => db.prepare(`SELECT id,event_name,event_type,event_date,event_time,topic,status
  FROM events
  WHERE (speaker_id = ? OR EXISTS (
    SELECT 1 FROM event_speakers WHERE event_speakers.event_id = events.id AND event_speakers.speaker_id = ?
  )) AND event_date < date('now')
  ORDER BY event_date DESC, event_time DESC, id DESC`).all(id, id);
const getSpeakerScheduledEvents = id => db.prepare(`SELECT id,event_name,event_type,event_date,event_time,topic,status
  FROM events
  WHERE (speaker_id = ? OR EXISTS (
    SELECT 1 FROM event_speakers WHERE event_speakers.event_id = events.id AND event_speakers.speaker_id = ?
  )) AND event_date >= date('now')
  ORDER BY event_date, event_time, id`).all(id, id);
const fields = body => [
  body.name.trim(), body.email?.trim() || `missing-email-${randomUUID()}@clinedpulse.invalid`, body.institution || '', body.specialty || '', body.expertise || '',
  body.faculty_profile_url || '', body.notes || '', body.participation_history || ''
];
const insertSpeaker = db.prepare(`INSERT INTO speakers
  (name,email,institution,specialty,expertise,faculty_profile_url,notes,participation_history,hub_key)
  VALUES (?,?,?,?,?,?,?,?,?)`);
const eventTypes = new Set(['Case Discussion', 'Summit Session', 'Faculty Workshop', 'Webinar', 'Post-Conference Update']);
const eventStatuses = new Set([
  'Planning', 'Speaker Invited', 'Speaker Confirmed', 'Zoom Scheduled', 'Materials Pending',
  'Event Ready', 'Completed', 'Follow-Up Complete'
]);
const speakerSorts = {
  name_asc: 'name COLLATE NOCASE ASC, id ASC',
  name_desc: 'name COLLATE NOCASE DESC, id DESC',
  specialty_asc: 'specialty COLLATE NOCASE ASC, name COLLATE NOCASE ASC',
  institution_asc: 'institution COLLATE NOCASE ASC, name COLLATE NOCASE ASC',
  newest: 'created_at DESC, id DESC'
};
const eventSorts = {
  date_desc: "CASE WHEN event_date = '' THEN 0 ELSE 1 END ASC, event_date DESC, event_time DESC, events.id DESC",
  date_asc: 'event_date ASC, event_time ASC, events.id ASC',
  closest_date: "ABS(julianday(event_date) - julianday('now')) ASC, event_date ASC, event_time ASC, events.id ASC",
  farthest_date: "ABS(julianday(event_date) - julianday('now')) DESC, event_date DESC, event_time DESC, events.id DESC",
  readiness_desc: 'readiness_score DESC, event_date DESC, event_time DESC',
  readiness_asc: 'readiness_score ASC, event_date DESC, event_time DESC'
};
const statusChecklistMap = {
  Planning: [],
  'Speaker Invited': [],
  'Speaker Confirmed': ['Speaker Confirmed'],
  'Zoom Scheduled': ['Speaker Confirmed', 'Zoom Created', 'Calendar Invite Sent'],
  'Materials Pending': [
    'Speaker Confirmed', 'Zoom Created', 'Calendar Invite Sent', 'Bio Collected',
    'Headshot Collected', 'Faculty Profile Added', 'Topic Finalized', 'Slides Requested',
    'Marketing Team Notified'
  ],
  'Event Ready': [
    'Speaker Confirmed', 'Zoom Created', 'Calendar Invite Sent', 'Bio Collected',
    'Headshot Collected', 'Faculty Profile Added', 'Topic Finalized', 'Slides Requested',
    'Slides Received', 'Consent Form Received', 'Marketing Team Notified'
  ],
  Completed: [
    'Speaker Confirmed', 'Zoom Created', 'Calendar Invite Sent', 'Bio Collected',
    'Headshot Collected', 'Faculty Profile Added', 'Topic Finalized', 'Slides Requested',
    'Slides Received', 'Consent Form Received', 'Marketing Team Notified'
  ],
  'Follow-Up Complete': checklistItems
};
const readinessWeightedScoreSql = `COALESCE(SUM(CASE
  WHEN event_checklist_items.completed = 1 THEN CASE event_checklist_items.label
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
END), 0)`;
const readinessScoreSql = `CASE
  WHEN COUNT(event_checklist_items.id) > 0
    AND COUNT(event_checklist_items.id) = COALESCE(SUM(CASE WHEN event_checklist_items.completed = 1 THEN 1 ELSE 0 END), 0)
    THEN 100
  ELSE MIN(${readinessWeightedScoreSql}, 99)
END`;

function validate(body) {
  if (!body.name?.trim()) throw Object.assign(new Error('Name is required'), { status: 400 });
  if (body.email?.trim() && !/^\S+@\S+\.\S+$/.test(body.email.trim())) {
    throw Object.assign(new Error('Enter a valid email or leave it blank'), { status: 400 });
  }
}

function validateEvent(body) {
  if (!body.event_name?.trim()) throw Object.assign(new Error('Event name is required'), { status: 400 });
  if (body.event_type && !eventTypes.has(body.event_type)) throw Object.assign(new Error('Choose a valid event type'), { status: 400 });
  if (body.status && !eventStatuses.has(body.status)) throw Object.assign(new Error('Choose a valid status'), { status: 400 });
}

function duplicateWarning(message) {
  return Object.assign(new Error(message), { status: 409, warning: true });
}

function constraintMessage(error) {
  const text = String(error.message || '');
  if (text.includes('idx_events_duplicate_guard')) {
    return 'An event with the same name, speaker, date, and time already exists.';
  }
  if (text.includes('speakers.email')) return 'A speaker with this email already exists.';
  return error.message;
}

function ensureSpeakerIsUnique(body, ignoreId = null) {
  if (!body.email?.trim()) return;
  const duplicate = db.prepare(`SELECT id,name,email FROM speakers
    WHERE lower(email) = lower(?) AND (? IS NULL OR id != ?)
    LIMIT 1`).get(body.email || '', ignoreId, ignoreId);
  if (duplicate) {
    throw duplicateWarning(`A speaker with this email already exists: ${duplicate.name}`);
  }
}

function ensureEventIsUnique(values, ignoreId = null) {
  const duplicate = db.prepare(`SELECT id,event_name FROM events
    WHERE lower(event_name) = lower(?)
    AND speaker_id = ?
    AND event_date = ?
    AND COALESCE(event_time, '') = COALESCE(?, '')
    AND (? IS NULL OR id != ?)
    LIMIT 1`).get(values[0], values[2], values[4], values[5] || '', ignoreId, ignoreId);
  if (duplicate) {
    throw duplicateWarning('An event with the same name, speaker, date, and time already exists.');
  }
}

function calendlyEnabled() {
  return process.env.ENABLE_CALENDLY === 'true';
}

function verifyCalendlySignature(req, raw) {
  const secret = process.env.CALENDLY_WEBHOOK_SECRET;
  if (!secret) return;
  const header = req.headers['calendly-webhook-signature'] || '';
  const parts = Object.fromEntries(String(header).split(',').map(part => part.trim().split('=')));
  if (!parts.t || !parts.v1) throw Object.assign(new Error('Missing Calendly webhook signature'), { status: 401 });
  const expected = createHmac('sha256', secret).update(`${parts.t}.${raw}`).digest('hex');
  const received = Buffer.from(parts.v1, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  if (received.length !== expectedBuffer.length || !timingSafeEqual(received, expectedBuffer)) {
    throw Object.assign(new Error('Invalid Calendly webhook signature'), { status: 401 });
  }
}

function calendlyQuestion(payload, names) {
  const wanted = names.map(name => name.toLowerCase());
  const answer = (payload.questions_and_answers || []).find(item => {
    const question = String(item.question || '').toLowerCase();
    return wanted.some(name => question.includes(name));
  });
  return answer?.answer?.trim() || '';
}

function inferCalendlyEventType(value = '') {
  const text = value.toLowerCase();
  if (text.includes('case')) return 'Case Discussion';
  if (text.includes('summit')) return 'Summit Session';
  if (text.includes('workshop') || text.includes('faculty')) return 'Faculty Workshop';
  if (text.includes('post-conference') || text.includes('post conference')) return 'Post-Conference Update';
  return 'Webinar';
}

function calendlyDateTime(startTime, timeZone) {
  const date = new Date(startTime);
  if (Number.isNaN(date.getTime())) throw Object.assign(new Error('Calendly event start time is required'), { status: 400 });
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  return { event_date: `${parts.year}-${parts.month}-${parts.day}`, event_time: `${parts.hour}:${parts.minute}` };
}

function calendlyEventBody(body) {
  if (body.event && body.event !== 'invitee.created') return { ignored: true, reason: body.event };
  const payload = body.payload || body;
  const scheduled = payload.scheduled_event || {};
  const name = payload.name || [payload.first_name, payload.last_name].filter(Boolean).join(' ').trim();
  const email = payload.email || '';
  if (!name || !email) throw Object.assign(new Error('Calendly invitee name and email are required'), { status: 400 });
  const timeZone = payload.timezone || scheduled.timezone || 'America/Chicago';
  const { event_date, event_time } = calendlyDateTime(scheduled.start_time || payload.start_time, timeZone);
  const scheduledName = scheduled.name || payload.event_type_name || 'Calendly Booking';
  const requestedType = calendlyQuestion(payload, ['event type', 'format']);
  const eventType = eventTypes.has(requestedType) ? requestedType : inferCalendlyEventType(`${requestedType} ${scheduledName}`);
  const topic = calendlyQuestion(payload, ['topic', 'presentation', 'session title']) || scheduledName;
  const location = scheduled.location || payload.location || {};
  return {
    event_name: calendlyQuestion(payload, ['event name', 'program title']) || scheduledName,
    event_type: eventType,
    speaker_name: name,
    speaker_email: email,
    event_date,
    event_time,
    topic,
    zoom_link: location.join_url || location.location || '',
    status: 'Speaker Confirmed',
    calendly_event_uri: scheduled.uri || payload.event || '',
    calendly_invitee_uri: payload.uri || '',
    speaker: {
      name,
      email,
      institution: calendlyQuestion(payload, ['institution', 'organization', 'hospital', 'university']),
      specialty: calendlyQuestion(payload, ['specialty', 'speciality', 'clinical area']),
      notes: `Created from Calendly booking${payload.uri ? `: ${payload.uri}` : ''}`
    }
  };
}

function ensureCalendlySpeaker(speaker) {
  const existing = db.prepare('SELECT * FROM speakers WHERE lower(email) = lower(?) ORDER BY id LIMIT 1').get(speaker.email);
  if (existing) return existing;
  validate(speaker);
  const result = insertSpeaker.run(
    speaker.name,
    speaker.email,
    speaker.institution || '',
    speaker.specialty || '',
    '',
    '',
    speaker.notes || '',
    '',
    'heme'
  );
  return getSpeaker(result.lastInsertRowid);
}

function createCalendlyEvent(body) {
  const event = calendlyEventBody(body);
  if (event.ignored) return event;
  const existing = event.calendly_invitee_uri
    ? db.prepare('SELECT id FROM events WHERE calendly_invitee_uri = ?').get(event.calendly_invitee_uri)
    : null;
  if (existing) return { duplicate: true, event: withChecklist(getEvent(existing.id)) };
  const speaker = ensureCalendlySpeaker(event.speaker);
  const result = db.prepare(`INSERT INTO events
    (event_name,event_type,speaker_id,speaker_name,event_date,event_time,topic,zoom_link,status,calendly_event_uri,calendly_invitee_uri)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    event.event_name,
    event.event_type,
    speaker.id,
    speaker.name,
    event.event_date,
    event.event_time,
    event.topic,
    event.zoom_link,
    event.status,
    event.calendly_event_uri,
    event.calendly_invitee_uri
  );
  syncEventSpeakers(result.lastInsertRowid, [speaker]);
  createEventChecklist(result.lastInsertRowid, checklistDueDates(event));
  applyStatusChecklist(result.lastInsertRowid, event.status);
  return { created: true, event: withChecklist(getEvent(result.lastInsertRowid)) };
}

function calendlyWebhookUrl(req) {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto = forwardedProto || (req.socket?.encrypted ? 'https' : 'http');
  const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${port}`;
  return `${proto}://${host}/api/calendly/webhook`;
}

function calendlyStatus(req) {
  return {
    enabled: true,
    webhook_url: calendlyWebhookUrl(req),
    signature_configured: Boolean(process.env.CALENDLY_WEBHOOK_SECRET),
    listens_for: ['invitee.created'],
    required_questions: ['Topic', 'Event Type', 'Institution', 'Specialty'],
    default_status: 'Speaker Confirmed',
    default_event_type: 'Webinar'
  };
}

function calendlyTestPayload() {
  const stamp = Date.now();
  return {
    event: 'invitee.created',
    payload: {
      uri: `https://api.calendly.com/scheduled_events/clinedpulse-test/invitees/${stamp}`,
      name: 'Dr. Calendly Test',
      email: `calendly.test.${stamp}@example.com`,
      timezone: 'America/Chicago',
      questions_and_answers: [
        { question: 'Institution', answer: 'Calendly Medical Center' },
        { question: 'Specialty', answer: 'Hematology' },
        { question: 'Topic', answer: 'Automated Scheduling Workflow' },
        { question: 'Event Type', answer: 'Webinar' }
      ],
      scheduled_event: {
        uri: `https://api.calendly.com/scheduled_events/clinedpulse-test-${stamp}`,
        name: 'Calendly Integration Test',
        start_time: '2026-12-10T16:30:00.000000Z',
        location: { type: 'zoom', join_url: 'https://zoom.us/j/calendly-test' }
      }
    }
  };
}

function resolveEventSpeaker(body) {
  if (body.speaker_id) return getSpeaker(body.speaker_id);
  const lookup = (body.speaker_email || body.speaker_name || body.speaker || '').trim();
  if (!lookup) return null;
  return db.prepare('SELECT * FROM speakers WHERE lower(email) = lower(?) OR lower(name) = lower(?) ORDER BY name LIMIT 1').get(lookup, lookup);
}

function resolveEventSpeakers(body, hub) {
  const requested = Array.isArray(body.speaker_ids) ? body.speaker_ids : body.speaker_id ? [body.speaker_id] : [];
  const ids = [...new Set(requested.map(value => Number(value)).filter(Number.isInteger))];
  const speakers = ids.map(getSpeaker).filter(speaker => speaker && (!hub || speaker.hub_key === hub));
  if (!speakers.length) {
    const fallback = resolveEventSpeaker(body);
    if (fallback && (!hub || fallback.hub_key === hub)) speakers.push(fallback);
  }
  return speakers;
}

function syncEventSpeakers(eventId, speakers) {
  db.prepare('DELETE FROM event_speakers WHERE event_id = ?').run(eventId);
  const insert = db.prepare('INSERT INTO event_speakers (event_id,speaker_id,position) VALUES (?,?,?)');
  speakers.forEach((speaker, position) => insert.run(eventId, speaker.id, position));
}

function eventFields(body, hub) {
  validateEvent(body);
  const speakers = resolveEventSpeakers(body, hub);
  const primary = speakers[0];
  return { values: [
    body.event_name.trim(), body.event_type || '', primary?.id || null, primary?.name || '',
    body.event_date || '', body.event_time || '', body.topic || '', body.zoom_link || '', body.status || 'Planning'
  ], speakers };
}

function eventInsertFields(body, hub) {
  return eventFields(body, hub);
}

function eventRequestKey(body) {
  const key = String(body.request_key || '').trim();
  if (key && !/^[A-Za-z0-9_-]{8,96}$/.test(key)) {
    throw Object.assign(new Error('Invalid event request key'), { status: 400 });
  }
  return key;
}

function eventReceiptByRequestKey(hub, requestKey) {
  if (!requestKey) return null;
  return db.prepare('SELECT id,request_key FROM events WHERE hub_key = ? AND request_key = ?').get(hub, requestKey);
}

const eventSelect = `SELECT events.*, COALESCE((
    SELECT group_concat(name, ', ') FROM (
      SELECT speakers.name name FROM event_speakers
      JOIN speakers ON speakers.id = event_speakers.speaker_id
      WHERE event_speakers.event_id = events.id
      ORDER BY event_speakers.position, speakers.name
    )
  ), speakers.name, events.speaker_name) speaker,
  COUNT(event_checklist_items.id) checklist_total,
  COALESCE(SUM(CASE WHEN event_checklist_items.completed = 1 THEN 1 ELSE 0 END), 0) checklist_done,
  ${readinessScoreSql} readiness_score
  FROM events
  LEFT JOIN speakers ON speakers.id = events.speaker_id
  LEFT JOIN event_checklist_items ON event_checklist_items.event_id = events.id`;

const getEvent = id => db.prepare(`${eventSelect} WHERE events.id = ? GROUP BY events.id`).get(id);
const getChecklist = eventId => db.prepare('SELECT * FROM event_checklist_items WHERE event_id = ? ORDER BY position, id').all(eventId);
const getEventSpeakers = eventId => {
  const speakers = db.prepare(`SELECT speakers.* FROM event_speakers
    JOIN speakers ON speakers.id = event_speakers.speaker_id
    WHERE event_speakers.event_id = ?
    ORDER BY event_speakers.position, speakers.name`).all(eventId).map(publicSpeaker);
  if (speakers.length) return speakers;
  const event = db.prepare('SELECT speaker_id FROM events WHERE id = ?').get(eventId);
  const fallback = event?.speaker_id ? getSpeaker(event.speaker_id) : null;
  return fallback ? [fallback] : [];
};

function withChecklist(event) {
  return event ? { ...event, speakers: getEventSpeakers(event.id), checklist: getChecklist(event.id) } : event;
}

function withSpeakerHistory(speaker) {
  if (!speaker) return speaker;
  const pastEvents = getSpeakerPastEvents(speaker.id);
  const scheduledEvents = getSpeakerScheduledEvents(speaker.id);
  const topics = [...new Set(pastEvents.map(event => event.topic).filter(Boolean))];
  const participationDates = [...new Set(pastEvents.map(event => event.event_date).filter(Boolean))];
  return {
    ...speaker,
    past_events: pastEvents,
    scheduled_events: scheduledEvents,
    topics_covered: topics,
    participation_dates: participationDates
  };
}

function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function defaultChecklistDueDates(eventDate) {
  if (!eventDate) return {};
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const eventDay = new Date(`${eventDate}T00:00:00`);
  const lastDueDay = new Date(eventDay);
  lastDueDay.setDate(lastDueDay.getDate() - 1);
  const end = lastDueDay < today ? eventDay : lastDueDay;
  const availableDays = Math.max(1, Math.floor((end - today) / 86400000));
  const step = Math.max(1, Math.floor(availableDays / checklistItems.length));
  return Object.fromEntries(checklistItems.map((item, index) => {
    const due = new Date(today);
    due.setDate(due.getDate() + step * (index + 1));
    if (due > end) due.setTime(end.getTime());
    return [item, dateOnly(due)];
  }));
}

function checklistDueDates(body) {
  const selected = body.checklist_due_dates && typeof body.checklist_due_dates === 'object' ? body.checklist_due_dates : {};
  const dueDates = Object.fromEntries(checklistItems.map(item => [item, selected[item] || '']));
  return Object.values(dueDates).some(Boolean) ? dueDates : defaultChecklistDueDates(body.event_date);
}

function createEventChecklist(eventId, dueDates = {}) {
  const statement = db.prepare('INSERT OR IGNORE INTO event_checklist_items (event_id,label,position,due_date) VALUES (?,?,?,?)');
  checklistItems.forEach((item, index) => statement.run(eventId, item, index + 1, dueDates[item] || null));
}

function updateChecklistDueDates(eventId, dueDates = {}) {
  const statement = db.prepare('UPDATE event_checklist_items SET due_date=?,updated_at=CURRENT_TIMESTAMP WHERE event_id=? AND label=?');
  Object.entries(dueDates).forEach(([label, dueDate]) => {
    if (checklistItems.includes(label)) statement.run(dueDate || null, eventId, label);
  });
}

function applyStatusChecklist(eventId, status) {
  const labels = statusChecklistMap[status] || [];
  if (!labels.length) return;
  const statement = db.prepare(`UPDATE event_checklist_items SET
    completed=1,
    completed_at=COALESCE(completed_at, CURRENT_TIMESTAMP),
    updated_at=CURRENT_TIMESTAMP
    WHERE event_id=? AND label=? AND completed=0`);
  labels.forEach(label => statement.run(eventId, label));
}

function taskRows(hub, where) {
  return db.prepare(`SELECT event_checklist_items.*, events.event_name, events.event_date,
    COALESCE(speakers.name, events.speaker_name) speaker
    FROM event_checklist_items
    JOIN events ON events.id = event_checklist_items.event_id
    LEFT JOIN speakers ON speakers.id = events.speaker_id
    WHERE events.hub_key = ? AND ${where}
    ORDER BY event_checklist_items.due_date IS NULL, event_checklist_items.due_date, events.event_date, event_checklist_items.position`).all(hub);
}

function overviewTasks(hub) {
  return {
    urgent: taskRows(hub, "event_checklist_items.completed = 0 AND event_checklist_items.due_date IS NOT NULL AND event_checklist_items.due_date <= date('now', '+7 days')"),
    upcoming: taskRows(hub, "event_checklist_items.completed = 0 AND event_checklist_items.due_date IS NOT NULL AND event_checklist_items.due_date BETWEEN date('now', '+8 days') AND date('now', '+21 days')"),
    todo: taskRows(hub, "event_checklist_items.completed = 0 AND (event_checklist_items.due_date IS NULL OR event_checklist_items.due_date > date('now', '+21 days'))")
  };
}

function importSpeakers(speakers, hub) {
  if (!Array.isArray(speakers)) throw Object.assign(new Error('Speakers must be an array'), { status: 400 });
  if (speakers.length > 1000) throw Object.assign(new Error('Import is limited to 1,000 rows at a time'), { status: 413 });

  const summary = { added: 0, skipped: 0, failed: 0, errors: [] };
  const seen = new Set();
  db.exec('BEGIN');
  try {
    speakers.forEach((speaker, index) => {
      try {
        validate(speaker);
        const email = speaker.email?.trim().toLowerCase() || '';
        if (email && seen.has(email)) {
          summary.skipped += 1;
          return;
        }
        if (email) seen.add(email);
        ensureSpeakerIsUnique(speaker);
        insertSpeaker.run(...fields(speaker), hub);
        summary.added += 1;
      } catch (error) {
        if (error.code?.startsWith('SQLITE_CONSTRAINT')) {
          summary.skipped += 1;
        } else {
          summary.failed += 1;
          summary.errors.push({ row: index + 1, error: error.message });
        }
      }
    });
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return summary;
}

function importEvents(events, hub) {
  if (!Array.isArray(events)) throw Object.assign(new Error('Events must be an array'), { status: 400 });
  if (events.length > 1000) throw Object.assign(new Error('Import is limited to 1,000 rows at a time'), { status: 413 });

  const summary = { added: 0, skipped: 0, failed: 0, errors: [] };
  const seen = new Set();
  db.exec('BEGIN');
  try {
    events.forEach((event, index) => {
      try {
        const { values, speakers } = eventInsertFields(event, hub);
        const duplicateKey = values.slice(0, 6).join('|').toLowerCase();
        if (seen.has(duplicateKey)) {
          summary.skipped += 1;
          return;
        }
        seen.add(duplicateKey);
        ensureEventIsUnique(values);
        db.prepare(`INSERT INTO events
          (event_name,event_type,speaker_id,speaker_name,event_date,event_time,topic,zoom_link,status,hub_key)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(...values, hub);
        const eventId = db.prepare('SELECT last_insert_rowid() id').get().id;
        syncEventSpeakers(eventId, speakers);
        createEventChecklist(eventId, checklistDueDates(event));
        applyStatusChecklist(eventId, values[8]);
        summary.added += 1;
      } catch (error) {
        summary.failed += 1;
        summary.errors.push({ row: index + 1, error: error.message });
      }
    });
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return summary;
}

const emailReviewSelect = `SELECT email_material_reviews.*,
  speakers.name speaker_name,
  events.event_name,
  events.event_date
  FROM email_material_reviews
  LEFT JOIN speakers ON speakers.id = email_material_reviews.speaker_id
  LEFT JOIN events ON events.id = email_material_reviews.event_id`;

function storeEmailMaterialReviews(email) {
  const senderEmail = normalizeEmailAddress(email.sender_email);
  const materials = detectEmailMaterials(email);
  if (!materials.length) return { created: 0, materials: [] };
  const speaker = senderEmail
    ? db.prepare('SELECT id,name,hub_key FROM speakers WHERE lower(email) = lower(?) LIMIT 1').get(senderEmail)
    : null;
  if (email.require_known_speaker && !speaker) {
    return { created: 0, materials, ignored: 'unknown_speaker' };
  }
  const hub = hubKey(speaker?.hub_key || email.hub_key);
  const matchedEvent = speaker
    ? db.prepare(`SELECT id,event_name,event_date FROM events
      WHERE (speaker_id = ? OR EXISTS (
        SELECT 1 FROM event_speakers WHERE event_speakers.event_id = events.id AND event_speakers.speaker_id = ?
      )) AND hub_key = ?
      ORDER BY CASE WHEN event_date >= date('now') THEN 0 ELSE 1 END,
        CASE WHEN event_date >= date('now') THEN event_date END ASC,
        event_date DESC, id DESC
      LIMIT 1`).get(speaker.id, speaker.id, hub)
    : null;
  const insert = db.prepare(`INSERT OR IGNORE INTO email_material_reviews
    (message_key,sender_email,recipient_email,subject,attachment_name,material_type,checklist_label,speaker_id,event_id,hub_key)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  let created = 0;
  for (const material of materials) {
    created += insert.run(
      email.message_key,
      senderEmail,
      normalizeEmailAddress(email.recipient_email),
      String(email.subject || '').slice(0, 500),
      String(material.attachment_name || '').slice(0, 500),
      material.type,
      material.label,
      speaker?.id || null,
      matchedEvent?.id || null,
      hub
    ).changes;
  }
  return { created, materials, speaker, event: matchedEvent };
}

function listEmailMaterialReviews(hub, status = 'pending') {
  const allowedStatus = ['pending', 'received', 'ignored'].includes(status) ? status : 'pending';
  return db.prepare(`${emailReviewSelect}
    WHERE email_material_reviews.hub_key = ? AND email_material_reviews.status = ?
    ORDER BY email_material_reviews.created_at DESC, email_material_reviews.id DESC`).all(hub, allowedStatus).map(review => ({
      ...review,
      title: materialNotificationTitle(
        review.material_type === 'slides' ? 'Slides' : review.material_type === 'biography' ? 'Biography' : 'Consent Form',
        review.speaker_name
      )
    }));
}

function reviewEmailMaterial(id, hub, action, requestedEventId) {
  if (!['received', 'ignored'].includes(action)) {
    throw Object.assign(new Error('Choose Mark Received or Ignore'), { status: 400 });
  }
  const review = db.prepare('SELECT * FROM email_material_reviews WHERE id=? AND hub_key=? LIMIT 1').get(id, hub);
  if (!review) throw Object.assign(new Error('Email review not found'), { status: 404 });
  if (review.status !== 'pending') throw Object.assign(new Error('This email has already been reviewed'), { status: 409 });
  if (action === 'ignored') {
    db.prepare(`UPDATE email_material_reviews SET
      status='ignored',reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND status='pending'`).run(id);
    return { ok: true, status: 'ignored' };
  }

  const eventId = Number(requestedEventId || review.event_id);
  if (!eventId) throw Object.assign(new Error('Match this email to an event before marking it received'), { status: 400 });
  const checklist = db.prepare(`SELECT event_checklist_items.id
    FROM event_checklist_items
    JOIN events ON events.id = event_checklist_items.event_id
    WHERE events.id = ? AND events.hub_key = ?
      AND event_checklist_items.label = ?
      AND (? IS NULL OR events.speaker_id = ? OR EXISTS (
        SELECT 1 FROM event_speakers WHERE event_speakers.event_id = events.id AND event_speakers.speaker_id = ?
      ))
    LIMIT 1`).get(eventId, hub, review.checklist_label, review.speaker_id, review.speaker_id, review.speaker_id);
  if (!checklist) throw Object.assign(new Error('A matching event checklist item could not be found'), { status: 404 });
  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE event_checklist_items SET
      completed=1,completed_at=COALESCE(completed_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP
      WHERE id=?`).run(checklist.id);
    db.prepare(`UPDATE email_material_reviews SET
      status='received',event_id=?,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND status='pending'`).run(eventId, id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { ok: true, status: 'received', event_id: eventId, checklist_label: review.checklist_label };
}

async function api(req, res, url) {
  const selectedHub = hubKey(url.searchParams.get('hub'));
  const mode = url.searchParams.get('mode') === 'test' ? 'test' : 'live';
  const hub = storageHubKey(selectedHub, mode);
  if (req.method === 'GET' && url.pathname === '/api/overview') {
    const total = db.prepare('SELECT COUNT(*) count FROM speakers WHERE hub_key = ?').get(hub).count;
    const specialties = db.prepare("SELECT COUNT(DISTINCT specialty) count FROM speakers WHERE specialty != '' AND hub_key = ?").get(hub).count;
    const institutions = db.prepare("SELECT COUNT(DISTINCT institution) count FROM speakers WHERE institution != '' AND hub_key = ?").get(hub).count;
    const eventTotal = db.prepare('SELECT COUNT(*) count FROM events WHERE hub_key = ?').get(hub).count;
    const upcomingEvents = db.prepare(`${eventSelect} WHERE event_date >= date('now') AND events.hub_key = ? GROUP BY events.id ORDER BY event_date, event_time, events.id LIMIT 5`).all(hub);
    const needsAttention = db.prepare(`SELECT COUNT(*) count FROM events
      WHERE status IN ('Planning','Speaker Invited','Materials Pending','Zoom Scheduled')
      AND event_date >= date('now') AND hub_key = ?`).get(hub).count;
    const completedEvents = db.prepare("SELECT COUNT(*) count FROM events WHERE status IN ('Completed','Follow-Up Complete') AND hub_key = ?").get(hub).count;
    const statusCounts = db.prepare('SELECT status, COUNT(*) count FROM events WHERE hub_key = ? GROUP BY status ORDER BY count DESC, status').all(hub);
    const tasks = overviewTasks(hub);
    return json(res, 200, {
      speakers: { total, specialties, institutions },
      events: {
        total: eventTotal,
        upcoming: upcomingEvents,
        needsAttention,
        completed: completedEvents,
        statusCounts,
        tasks,
        todoTasks: tasks.todo.length,
        urgentTasks: tasks.urgent.length,
        upcomingTasks: tasks.upcoming.length
      },
      total, specialties, institutions, recent: db.prepare('SELECT * FROM speakers WHERE hub_key = ? ORDER BY created_at DESC, id DESC LIMIT 5').all(hub).map(publicSpeaker)
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/speakers') {
    const q = `%${url.searchParams.get('q') || ''}%`;
    const searchBy = url.searchParams.get('searchBy') || 'all';
    const sort = url.searchParams.get('sort') || 'name_asc';
    const orderBy = speakerSorts[sort] || speakerSorts.name_asc;
    const searchColumns = {
      name: ['name'],
      specialty: ['specialty'],
      expertise: ['expertise'],
      institution: ['institution'],
      all: ['name', 'specialty', 'expertise', 'institution']
    }[searchBy] || ['name', 'specialty', 'expertise', 'institution'];
    const where = searchColumns.map(column => `${column} LIKE ?`).join(' OR ');
    const rows = db.prepare(`SELECT * FROM speakers WHERE hub_key = ? AND (${where}) ORDER BY ${orderBy}`).all(hub, ...searchColumns.map(() => q));
    return json(res, 200, rows.map(publicSpeaker));
  }

  if (req.method === 'GET' && url.pathname === '/api/events') {
    const filters = ['events.hub_key = ?'];
    const values = [hub];
    const month = url.searchParams.get('month') || '';
    const type = url.searchParams.get('type') || '';
    const status = url.searchParams.get('status') || '';
    const sort = url.searchParams.get('sort') || 'date_desc';
    const orderBy = eventSorts[sort] || eventSorts.date_desc;
    if (month) {
      filters.push("strftime('%Y-%m', event_date) = ?");
      values.push(month);
    }
    if (type) {
      filters.push('event_type = ?');
      values.push(type);
    }
    if (status) {
      filters.push('status = ?');
      values.push(status);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const rows = db.prepare(`${eventSelect} ${where} GROUP BY events.id ORDER BY ${orderBy}`).all(...values);
    return json(res, 200, rows);
  }

  if (req.method === 'GET' && url.pathname === '/api/calendly/status') {
    if (!calendlyEnabled()) return json(res, 404, { error: 'Not found' });
    return json(res, 200, calendlyStatus(req));
  }

  if (req.method === 'GET' && url.pathname === '/api/email-materials') {
    return json(res, 200, listEmailMaterialReviews(hub, url.searchParams.get('status') || 'pending'));
  }

  if (req.method === 'POST' && url.pathname === '/api/email-materials/ingest') {
    const raw = await readBody(req);
    const verification = await verifyWebhookSignature({
      secret: process.env.EMAIL_INGEST_SECRET,
      timestamp: req.headers['x-clinedpulse-timestamp'],
      signature: req.headers['x-clinedpulse-signature'],
      body: raw
    });
    if (!verification.ok) {
      const status = verification.reason === 'not_configured' ? 503 : 401;
      throw Object.assign(new Error('Email ingestion authorization failed'), { status });
    }
    const body = parseJson(raw);
    return json(res, 202, storeEmailMaterialReviews({ ...body, require_known_speaker: true }));
  }

  const emailReviewMatch = url.pathname.match(/^\/api\/email-materials\/(\d+)\/review$/);
  if (emailReviewMatch && req.method === 'PUT') {
    const body = await parseBody(req);
    return json(res, 200, reviewEmailMaterial(emailReviewMatch[1], hub, body.action, body.event_id));
  }

  if (req.method === 'POST' && url.pathname === '/api/speakers') {
    const body = await parseBody(req); validate(body);
    ensureSpeakerIsUnique(body);
    const result = insertSpeaker.run(...fields(body), hub);
    return json(res, 201, getSpeaker(result.lastInsertRowid));
  }

  if (req.method === 'POST' && url.pathname === '/api/speakers/import') {
    const body = await parseBody(req);
    return json(res, 201, importSpeakers(body.speakers, hub));
  }

  if (req.method === 'POST' && url.pathname === '/api/calendly/webhook') {
    if (!calendlyEnabled()) return json(res, 404, { error: 'Not found' });
    const raw = await readBody(req);
    verifyCalendlySignature(req, raw);
    const result = createCalendlyEvent(parseJson(raw));
    return json(res, result.ignored ? 202 : result.duplicate ? 200 : 201, result);
  }

  if (req.method === 'POST' && url.pathname === '/api/calendly/test') {
    if (!calendlyEnabled()) return json(res, 404, { error: 'Not found' });
    const result = createCalendlyEvent(calendlyTestPayload());
    return json(res, 201, { ...result, test: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/events') {
    const body = await parseBody(req);
    const requestKey = eventRequestKey(body);
    const existing = eventReceiptByRequestKey(hub, requestKey);
    if (existing) return json(res, 200, existing);
    const { values, speakers } = eventInsertFields(body, hub);
    ensureEventIsUnique(values);
    let result;
    try {
      result = db.prepare(`INSERT INTO events
        (event_name,event_type,speaker_id,speaker_name,event_date,event_time,topic,zoom_link,status,hub_key,request_key)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(...values, hub, requestKey);
    } catch (error) {
      const retried = eventReceiptByRequestKey(hub, requestKey);
      if (retried) return json(res, 200, retried);
      throw error;
    }
    syncEventSpeakers(result.lastInsertRowid, speakers);
    createEventChecklist(result.lastInsertRowid, checklistDueDates(body));
    applyStatusChecklist(result.lastInsertRowid, values[8]);
    return json(res, 201, { id: result.lastInsertRowid, request_key: requestKey });
  }

  if (req.method === 'POST' && url.pathname === '/api/events/import') {
    const body = await parseBody(req);
    return json(res, 201, importEvents(body.events, hub));
  }

  const match = url.pathname.match(/^\/api\/speakers\/(\d+)$/);
  if (match && req.method === 'GET') {
    const speaker = getSpeaker(match[1]);
    return speaker ? json(res, 200, withSpeakerHistory(speaker)) : json(res, 404, { error: 'Speaker not found' });
  }

  if (match && req.method === 'PUT') {
    const body = await parseBody(req); validate(body);
    ensureSpeakerIsUnique(body, match[1]);
    const result = db.prepare(`UPDATE speakers SET
      name=?,email=?,institution=?,specialty=?,expertise=?,faculty_profile_url=?,notes=?,participation_history=?,updated_at=CURRENT_TIMESTAMP
      WHERE id=?`).run(...fields(body), match[1]);
    return result.changes ? json(res, 200, getSpeaker(match[1])) : json(res, 404, { error: 'Speaker not found' });
  }

  if (match && req.method === 'DELETE') {
    const result = db.prepare('DELETE FROM speakers WHERE id = ?').run(match[1]);
    return result.changes ? json(res, 200, { ok: true }) : json(res, 404, { error: 'Speaker not found' });
  }

  const eventRequestMatch = url.pathname.match(/^\/api\/events\/request\/([A-Za-z0-9_-]+)$/);
  if (eventRequestMatch && req.method === 'GET') {
    const requestKey = eventRequestKey({ request_key: eventRequestMatch[1] });
    const receipt = eventReceiptByRequestKey(hub, requestKey);
    return receipt ? json(res, 200, receipt) : json(res, 404, { error: 'Event not found' });
  }

  const eventMatch = url.pathname.match(/^\/api\/events\/(\d+)$/);
  if (eventMatch && req.method === 'GET') {
    const event = getEvent(eventMatch[1]);
    return event ? json(res, 200, withChecklist(event)) : json(res, 404, { error: 'Event not found' });
  }

  if (eventMatch && req.method === 'PUT') {
    const body = await parseBody(req);
    const { values, speakers } = eventFields(body, hub);
    ensureEventIsUnique(values, eventMatch[1]);
    const result = db.prepare(`UPDATE events SET
      event_name=?,event_type=?,speaker_id=?,speaker_name=?,event_date=?,event_time=?,topic=?,zoom_link=?,status=?,updated_at=CURRENT_TIMESTAMP
      WHERE id=?`).run(...values, eventMatch[1]);
    if (result.changes) {
      syncEventSpeakers(eventMatch[1], speakers);
      updateChecklistDueDates(eventMatch[1], checklistDueDates(body));
      applyStatusChecklist(eventMatch[1], values[8]);
    }
    return result.changes ? json(res, 200, withChecklist(getEvent(eventMatch[1]))) : json(res, 404, { error: 'Event not found' });
  }

  const checklistMatch = url.pathname.match(/^\/api\/events\/(\d+)\/checklist\/(\d+)$/);
  if (checklistMatch && req.method === 'PUT') {
    const body = await parseBody(req);
    const completed = body.completed ? 1 : 0;
    const result = db.prepare(`UPDATE event_checklist_items SET
      completed=?,completed_at=CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE NULL END,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND event_id=?`).run(completed, completed, checklistMatch[2], checklistMatch[1]);
    return result.changes ? json(res, 200, withChecklist(getEvent(checklistMatch[1]))) : json(res, 404, { error: 'Checklist item not found' });
  }

  if (eventMatch && req.method === 'DELETE') {
    const result = db.prepare('DELETE FROM events WHERE id = ?').run(eventMatch[1]);
    return result.changes ? json(res, 200, { ok: true }) : json(res, 404, { error: 'Event not found' });
  }

  return json(res, 404, { error: 'Not found' });
}

async function serveStatic(res, pathname) {
  const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
  const safe = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, '');
  const file = join(publicDir, safe);
  if (!file.startsWith(publicDir)) return json(res, 403, { error: 'Forbidden' });
  const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
  try {
    const content = await readFile(file);
    res.writeHead(200, { 'content-type': `${types[extname(file)] || 'application/octet-stream'}; charset=utf-8` });
    res.end(content);
  } catch { json(res, 404, { error: 'Not found' }); }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else await serveStatic(res, url.pathname);
  } catch (error) {
    console.error(error);
    const status = error.code?.startsWith('SQLITE_CONSTRAINT') ? 409 : error.status || 500;
    json(res, status, { error: constraintMessage(error) });
  }
});

server.listen(port, () => console.log(`ClinEdPulse Speaker Database running at http://localhost:${port}`));
