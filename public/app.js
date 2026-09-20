const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const view = $('#view');
const modal = $('#modal');

const hubs = {
  heme: { name: 'HemeHub', label: 'HEMEHUB', color: '#6f1219' },
  endo: { name: 'EndoExpertHub', label: 'ENDO EXPERT HUB', color: '#075f4b' },
  gastro: { name: 'GastroExpertHub', label: 'GASTRO EXPERT HUB', color: '#713c06' }
};
let activeHub = 'heme';
let activeDataMode = localStorage.getItem('clinedpulse-data-mode') === 'test' ? 'test' : 'live';
let speakerDragCandidate = null;

function speakerQueueKey() {
  return `clinedpulse-event-speaker-queue:${activeHub}:${activeDataMode}`;
}

function queuedSpeakers() {
  try {
    const queued = JSON.parse(sessionStorage.getItem(speakerQueueKey()) || '[]');
    return Array.isArray(queued) ? queued : [];
  } catch {
    return [];
  }
}

function updateSpeakerQueueBadge() {
  const badge = $('#eventSpeakerQueueCount');
  if (!badge) return;
  const count = queuedSpeakers().length;
  badge.textContent = count;
  badge.hidden = count === 0;
}

function queueSpeakerForEvent(speaker) {
  const queued = queuedSpeakers();
  if (!queued.some(item => String(item.id) === String(speaker.id))) {
    queued.push({ id: Number(speaker.id), name: speaker.name || 'Speaker' });
    sessionStorage.setItem(speakerQueueKey(), JSON.stringify(queued));
  }
  updateSpeakerQueueBadge();
  return queued.length;
}

function clearSpeakerQueue() {
  sessionStorage.removeItem(speakerQueueKey());
  updateSpeakerQueueBadge();
}

function setHub(hubKey, announce = false) {
  const key = hubs[hubKey] ? hubKey : 'heme';
  const hub = hubs[key];
  activeHub = key;
  document.documentElement.dataset.hub = key;
  $$('.hub-option').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.hub === key)));
  $('#brandHub').textContent = hub.name;
  $('#sidebarHub').textContent = hub.label;
  $('meta[name="theme-color"]').setAttribute('content', hub.color);
  localStorage.setItem('clinedpulse-hub', key);
  updateSpeakerQueueBadge();
  if (announce) {
    toast(`${hub.name} workspace selected`);
    router();
  }
}

function setDataMode(mode, announce = false) {
  activeDataMode = mode === 'test' ? 'test' : 'live';
  const isTest = activeDataMode === 'test';
  document.documentElement.dataset.mode = activeDataMode;
  $('#testModeToggle')?.setAttribute('aria-pressed', String(isTest));
  $('#testModeLabel').textContent = isTest ? 'Test data' : 'Real data';
  localStorage.setItem('clinedpulse-data-mode', activeDataMode);
  updateSpeakerQueueBadge();
  if (announce) {
    modal.close();
    toast(isTest ? 'Test mode enabled — real data is hidden' : 'Real data restored');
    router();
  }
}

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[char]));
const initials = name => (name || '?').split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase();
const avatar = speaker => `<span class="avatar">${initials(speaker.name)}</span>`;
let importRows = [];
let eventImportRows = [];
const emailPattern = /^\S+@\S+\.\S+$/;
const eventTypes = ['Case Discussion', 'Summit Session', 'Faculty Workshop', 'Webinar', 'Post-Conference Update'];
const eventStatuses = [
  'Planning', 'Speaker Invited', 'Speaker Confirmed', 'Zoom Scheduled', 'Materials Pending',
  'Event Ready', 'Completed', 'Follow-Up Complete'
];
const speakerSortOptions = [
  ['name_asc', 'Name A-Z'],
  ['name_desc', 'Name Z-A'],
  ['specialty_asc', 'Specialty A-Z'],
  ['institution_asc', 'Institution A-Z'],
  ['newest', 'Newest added']
];
const eventSortOptions = [
  ['date_desc', 'Unscheduled, then newest'],
  ['date_asc', 'Date oldest first'],
  ['closest_date', 'Closest date'],
  ['farthest_date', 'Farthest date'],
  ['readiness_desc', 'Readiness high-low'],
  ['readiness_asc', 'Readiness low-high']
];
const embeddedTestEventRows = {
  heme: [
    [67, 'Heme Test Transplant Complications Roundtable', 'Roundtable', 'Dr. Sofia Martinez', '2026-11-08', '15:00', 'Event Ready', 11, 99],
    [66, 'Heme Test CAR-T Operations Lab', 'Faculty Workshop', 'Dr. Sofia Martinez', '2026-10-24', '14:30', 'Zoom Scheduled', 3, 20],
    [65, 'Heme Test Lymphoma Tumor Board', 'Tumor Board', 'Dr. Benjamin Cole', '2026-10-10', '13:00', 'Speaker Invited', 0, 0],
    [64, 'Heme Test AML Case Exchange', 'Case Discussion', 'Dr. Aisha Rahman', '2026-09-26', '12:00', 'Planning', 0, 0],
    [69, 'Heme Test Myeloma Conference Debrief', 'Conference Debrief', 'Dr. Benjamin Cole', '2026-09-07', '12:30', 'Completed', 11, 99],
    [68, 'Heme Test Benign Hematology Update', 'Webinar', 'Dr. Ethan Brooks', '2026-08-05', '11:00', 'Follow-Up Complete', 12, 100],
    [58, 'HemeHub Test Webinar', 'Webinar', 'Dr. Maya Chen', '2026-08-03', '14:00', 'Materials Pending', 8, 60],
    [59, 'HemeHub Completed Test Session', 'Case Discussion', 'Dr. Noah Williams', '2026-06-20', '11:00', 'Completed', 11, 99]
  ],
  endo: [
    [73, 'Endo Test Adrenal Disorders Summit', 'Summit Session', 'Dr. Leo Bennett', '2026-10-31', '15:30', 'Event Ready', 11, 99],
    [72, 'Endo Test Pituitary Imaging Workshop', 'Faculty Workshop', 'Dr. Daniel Foster', '2026-10-17', '14:00', 'Zoom Scheduled', 3, 20],
    [71, 'Endo Test Diabetes Technology Roundtable', 'Roundtable', 'Dr. Amara Okafor', '2026-10-05', '13:00', 'Speaker Confirmed', 1, 10],
    [70, 'Endo Test Thyroid Nodule Case Lab', 'Case Discussion', 'Dr. Hannah Kim', '2026-09-24', '09:00', 'Planning', 0, 0],
    [75, 'Endo Test Bone Health Debrief', 'Conference Debrief', 'Dr. Luis Rivera', '2026-09-09', '12:00', 'Completed', 11, 99],
    [74, 'Endo Test Obesity Care Update', 'Webinar', 'Dr. Priya Shah', '2026-08-15', '10:00', 'Follow-Up Complete', 12, 100],
    [60, 'Endo Test Faculty Workshop', 'Faculty Workshop', 'Dr. Luis Rivera', '2026-08-07', '13:30', 'Materials Pending', 9, 80],
    [61, 'Endo Completed Test Webinar', 'Webinar', 'Dr. Priya Shah', '2026-06-29', '10:00', 'Completed', 11, 99]
  ],
  gastro: [
    [79, 'Gastro Test Motility Disorders Forum', 'Roundtable', 'Dr. Samuel Lee', '2026-10-28', '15:00', 'Event Ready', 11, 99],
    [78, 'Gastro Test Advanced Endoscopy Workshop', 'Faculty Workshop', 'Dr. Nia Campbell', '2026-10-13', '14:00', 'Materials Pending', 8, 60],
    [77, 'Gastro Test Liver Disease Update', 'Webinar', 'Dr. Julian Wright', '2026-10-04', '12:00', 'Speaker Confirmed', 1, 10],
    [76, 'Gastro Test IBD Case Exchange', 'Case Discussion', 'Dr. Isabel Torres', '2026-09-25', '11:30', 'Speaker Invited', 0, 0],
    [81, 'Gastro Test Nutrition Conference Debrief', 'Conference Debrief', 'Dr. Marcus Green', '2026-09-11', '13:30', 'Completed', 11, 99],
    [80, 'Gastro Test Colorectal Screening Review', 'Webinar', 'Dr. Elena Park', '2026-08-10', '10:30', 'Follow-Up Complete', 12, 100],
    [62, 'Gastro Test Summit Session', 'Summit Session', 'Dr. Elena Park', '2026-07-30', '15:00', 'Materials Pending', 8, 60],
    [63, 'Gastro Completed Test Discussion', 'Case Discussion', 'Dr. Marcus Green', '2026-07-04', '12:00', 'Completed', 11, 99]
  ]
};
const checklistDueLabels = [
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
const readinessWeights = {
  'Speaker Confirmed': 10,
  'Zoom Created': 10,
  'Bio Collected': 10,
  'Headshot Collected': 10,
  'Topic Finalized': 10,
  'Slides Requested': 10,
  'Slides Received': 20,
  'Consent Form Received': 20
};

function scopedApiPath(path) {
  const separator = path.includes('?') ? '&' : '?';
  return path.startsWith('/api/')
    ? `${path}${separator}hub=${encodeURIComponent(activeHub)}&mode=${encodeURIComponent(activeDataMode)}`
    : path;
}

async function api(path, options = {}, attempt = 0) {
  const scopedPath = scopedApiPath(path);
  const method = String(options.method || 'GET').toUpperCase();
  let body = options.body;
  let retryableEventSave = false;
  if (body) {
    try {
      const parsed = JSON.parse(body);
      retryableEventSave = method === 'POST'
        && path.split('?')[0] === '/api/events'
        && Boolean(parsed.request_key);
      body = JSON.stringify({ ...parsed, hub_key: activeHub });
    } catch {}
  }
  let response;
  try {
    response = await fetch(scopedPath, {
      headers: { 'content-type': 'application/json' },
      ...options,
      body,
      cache: method === 'GET' ? 'no-store' : options.cache
    });
  } catch (error) {
    if ((method === 'GET' || retryableEventSave) && attempt < 2) {
      await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
      return api(path, options, attempt + 1);
    }
    throw new Error('Could not reach ClinEdPulse. Check your connection and try again.');
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(response.ok
      ? 'ClinEdPulse returned an unreadable response. Please try again.'
      : `ClinEdPulse request failed (${response.status}).`);
  }
  if (!response.ok && (method === 'GET' || retryableEventSave) && response.status >= 500 && attempt < 2) {
    await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
    return api(path, options, attempt + 1);
  }
  if (!response.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function findCreatedEvent(requestKey, delays) {
  for (const delay of delays) {
    if (delay) await pause(delay);
    try {
      return await api(`/api/events/request/${encodeURIComponent(requestKey)}`);
    } catch {}
  }
  return null;
}

async function recoverCreatedEvent(body) {
  const saved = await findCreatedEvent(body.request_key, [150, 450]);
  if (saved) return saved;

  let queued = false;
  try {
    queued = navigator.sendBeacon(scopedApiPath('/api/events'), JSON.stringify({ ...body, hub_key: activeHub }));
  } catch {}
  return queued ? findCreatedEvent(body.request_key, [300, 750, 1500]) : null;
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  setTimeout(() => element.classList.remove('show'), 2500);
}

function empty(message, title = 'No speakers yet') {
  return `<div class="empty"><span>✦</span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p></div>`;
}

function embeddedTestEvents(hub = activeHub) {
  return (embeddedTestEventRows[hub] || []).map(row => ({
    id: row[0],
    event_name: row[1],
    event_type: row[2],
    speaker_name: row[3],
    speaker: row[3],
    event_date: row[4],
    event_time: row[5],
    status: row[6],
    checklist_done: row[7],
    readiness_score: row[8],
    checklist_total: 12,
    hub_key: `test-${hub}`,
    topic: '',
    zoom_link: ''
  }));
}

function filterEmbeddedEvents(events, { month, type, status, sort }) {
  const filtered = events.filter(event =>
    (!month || event.event_date.startsWith(month)) &&
    (!type || event.event_type === type) &&
    (!status || event.status === status)
  );
  const eventTime = event => new Date(`${event.event_date}T${event.event_time || '00:00'}`).valueOf();
  const undatedFirst = (a, b) => Number(Boolean(a.event_date)) - Number(Boolean(b.event_date));
  const today = Date.now();
  const sorters = {
    date_desc: (a, b) => undatedFirst(a, b) || eventTime(b) - eventTime(a),
    date_asc: (a, b) => eventTime(a) - eventTime(b),
    closest_date: (a, b) => Math.abs(eventTime(a) - today) - Math.abs(eventTime(b) - today),
    farthest_date: (a, b) => Math.abs(eventTime(b) - today) - Math.abs(eventTime(a) - today),
    readiness_desc: (a, b) => Number(b.readiness_score || 0) - Number(a.readiness_score || 0),
    readiness_asc: (a, b) => Number(a.readiness_score || 0) - Number(b.readiness_score || 0)
  };
  return filtered.sort(sorters[sort] || sorters.date_desc);
}

function eventCacheKey(path) {
  return `clinedpulse-events:${activeHub}:${activeDataMode}:${path}`;
}

async function loadEvents(path, filters) {
  const cacheKey = eventCacheKey(path);
  try {
    const events = await api(path);
    localStorage.setItem(cacheKey, JSON.stringify(events));
    return events;
  } catch {
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
      if (Array.isArray(cached)) return cached;
    } catch {}
    if (activeDataMode === 'test') {
      return filterEmbeddedEvents(embeddedTestEvents(), filters);
    }
    return [];
  }
}

function activate(route) {
  $$('[data-route]').forEach(link => link.classList.toggle('active', link.dataset.route === route));
}

function speakerRow(speaker) {
  return `<tr data-id="${speaker.id}" data-speaker-name="${escapeHtml(speaker.name)}" draggable="true" title="Drag this speaker onto Events to add them to an event">
    <td><div class="person"><span class="drag-handle" aria-hidden="true">⋮⋮</span>${avatar(speaker)}<div><b>${escapeHtml(speaker.name)}</b><small>${escapeHtml(speaker.email || 'Email not recorded')}</small></div></div></td>
    <td>${escapeHtml(speaker.specialty || '—')}</td>
    <td>${escapeHtml(speaker.expertise || '—')}</td>
    <td>${escapeHtml(speaker.institution || '—')}</td>
    <td><button class="queue-speaker" type="button" data-queue-speaker="${speaker.id}" aria-label="Queue ${escapeHtml(speaker.name)} for an event">+ Event</button></td>
  </tr>`;
}

function statusSelect(event, compact = true) {
  return `<select class="status-select ${compact ? 'compact' : ''}" data-status-event-id="${event.id}" aria-label="Change status for ${escapeHtml(event.event_name)}">
    ${eventStatuses.map(status => `<option value="${escapeHtml(status)}" ${status === event.status ? 'selected' : ''}>${escapeHtml(status)}</option>`).join('')}
  </select>`;
}

function eventRow(event) {
  const score = Number(event.readiness_score || 0);
  return `<tr data-event-id="${event.id}">
    <td><b>${escapeHtml(event.event_name)}</b><small>${escapeHtml(event.event_type)}</small></td>
    <td>${escapeHtml(event.speaker || event.speaker_name || '—')}</td>
    <td>${formatEventDate(event.event_date)}${event.event_time ? `<small>${escapeHtml(event.event_time)}</small>` : ''}</td>
    <td>${statusSelect(event)}</td>
    <td data-readiness-event-id="${event.id}">${readiness(score, Number(event.checklist_done || 0), Number(event.checklist_total || 0))}</td>
  </tr>`;
}

function speakerHistoryView(speaker) {
  const pastEvents = speaker.past_events || [];
  const scheduledEvents = speaker.scheduled_events || [];
  const topics = speaker.topics_covered || [];
  const dates = speaker.participation_dates || [];
  const eventRows = (events, emptyTitle, emptyMessage) => {
    const rows = events.map(event => `
      <div class="history-event" data-event-id="${event.id}">
      <div>
        <b>${escapeHtml(event.topic || event.event_name)}</b>
        <small>${escapeHtml(event.event_name)} · ${escapeHtml(event.event_type)} · ${formatEventDate(event.event_date)}${event.event_time ? ` at ${escapeHtml(event.event_time)}` : ''}</small>
      </div>
      <span class="pill gray">${escapeHtml(event.status)}</span>
    </div>`).join('');
    return rows ? `<div class="history-list">${rows}</div>` : empty(emptyMessage, emptyTitle);
  };
  return `
    <div class="history-summary">
      <span><b>${pastEvents.length}</b><small>Past events</small></span>
      <span><b>${scheduledEvents.length}</b><small>Scheduled events</small></span>
      <span><b>${topics.length}</b><small>Topics covered</small></span>
    </div>
    ${dates.length ? `<div class="history-meta"><b>Participation dates</b><span>${dates.map(formatEventDate).join(', ')}</span></div>` : ''}
    ${topics.length ? `<div class="topic-stack">${topics.map(topic => `<span class="pill">${escapeHtml(topic)}</span>`).join('')}</div>` : ''}
    <div class="history-section"><h4>Past events</h4>${eventRows(pastEvents, 'No past event history', 'Only events before today appear in past history.')}</div>
    <div class="history-section"><h4>Scheduled events</h4>${eventRows(scheduledEvents, 'No scheduled events', 'Current and upcoming events will appear here once this speaker is scheduled.')}</div>`;
}

function normalizedReadinessScore(score, done, total) {
  const percent = Math.max(0, Math.min(100, Math.round(Number(score || 0))));
  if (total && done < total && percent >= 100) return 99;
  return percent;
}

function readinessState(score, done, total) {
  const percent = normalizedReadinessScore(score, done, total);
  if (percent >= 80) return { percent, label: 'Ready', level: 'ready' };
  if (percent >= 50) return { percent, label: 'Needs Attention', level: 'mid' };
  return { percent, label: 'At Risk', level: 'low' };
}

function readiness(score, done, total) {
  const state = readinessState(score, done, total);
  return `<div class="readiness ${state.level}"><span class="readiness-track"><i style="width:${state.percent}%"></i></span><b>${state.percent}%</b><small>${state.label}</small></div>`;
}

function checklistView(event) {
  const items = event.checklist || [];
  if (!items.length) return empty('Checklist items will appear here after the event is saved.');
  return `<div class="checklist">${items.map(item => `
    <label class="check">
      <input type="checkbox" data-checklist-id="${item.id}" data-due-date="${escapeHtml(item.due_date || '')}" ${item.completed ? 'checked' : ''}>
      <span class="${item.completed ? 'done' : ''}">${escapeHtml(item.label)}</span>
      <small>${item.completed ? 'Done' : taskDueText(item.due_date)}</small>
    </label>`).join('')}</div>`;
}

function checklistReadinessScore() {
  return $$('[data-checklist-id]').reduce((score, input) => {
    const label = input.closest('.check')?.querySelector('span')?.textContent || '';
    return score + (input.checked ? readinessWeights[label] || 0 : 0);
  }, 0);
}

function updateChecklistCount(eventId, done, total, score = checklistReadinessScore()) {
  const fallbackTotal = total || 12;
  const modalCount = $('#checklistCount');
  if (modalCount) modalCount.textContent = `${done}/${fallbackTotal}`;
  const modalReadiness = $('#eventReadiness');
  if (modalReadiness) modalReadiness.innerHTML = readiness(score, done, fallbackTotal);
  const tableProgress = $(`[data-readiness-event-id="${eventId}"]`);
  if (tableProgress) tableProgress.innerHTML = readiness(score, done, fallbackTotal);
}

function formatEventDate(value) {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function taskDueText(value) {
  if (!value) return 'Open';
  return `Due ${formatEventDate(value)}`;
}

function taskTiming(value) {
  if (!value) return '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${value}T00:00:00`);
  const days = Math.round((due - today) / 86400000);
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`;
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  if (days < 7) return `due in ${days} days`;
  if (days < 14) return 'due next week';
  return `due ${formatEventDate(value)}`;
}

function groupedTasks(tasks) {
  const groups = new Map();
  tasks.forEach(task => {
    const speaker = task.speaker || 'No speaker';
    const key = speaker.toLowerCase();
    if (!groups.has(key)) groups.set(key, { speaker, eventId: task.event_id, tasks: [] });
    groups.get(key).tasks.push(task);
  });
  return [...groups.values()];
}

function taskRows(tasks, tone) {
  if (!tasks?.length) {
    const title = tone === 'red' ? 'Nothing urgent' : tone === 'amber' ? 'Nothing upcoming' : 'Nothing later';
    return empty(tone === 'red' ? 'No tasks due within the next week.' : tone === 'amber' ? 'No tasks due 2-3 weeks from now.' : 'Open tasks outside urgent and upcoming will appear here.', title);
  }
  return `<div class="task-alert-list">${groupedTasks(tasks).map(group => {
    return `<div class="task-alert ${tone}" data-event-id="${group.eventId}">
      <span class="dot ${tone === 'red' ? 'red' : tone === 'amber' ? '' : 'green'}"></span>
      <div>
        <b>${escapeHtml(group.speaker)} <span>${group.tasks.length} task${group.tasks.length === 1 ? '' : 's'}</span></b>
        ${group.tasks.map(task => `<small>${escapeHtml(task.label)} · ${escapeHtml(task.event_name)} · ${taskTiming(task.due_date)}</small>`).join('')}
      </div>
    </div>`;
  }).join('')}</div>`;
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function options(values, selected = '', fallback = '') {
  return `${fallback ? `<option value="">${fallback}</option>` : ''}${values.map(value => `<option value="${escapeHtml(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('')}`;
}

function optionPairs(values, selected = '') {
  return values.map(([value, label]) => `<option value="${escapeHtml(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('');
}

function parseDelimited(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  const delimiter = (text.split('\n')[0].match(/\t/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? '\t' : ',';

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"') {
      if (quoted && next === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      row.push(value.trim());
      value = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(value.trim());
      if (row.some(cell => cell)) rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }
  row.push(value.trim());
  if (row.some(cell => cell)) rows.push(row);
  return rows;
}

function excelColumnToIndex(reference) {
  return [...reference.replace(/\d+/g, '')].reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

function stripXmlNamespace(name) {
  return name.includes(':') ? name.split(':').pop() : name;
}

function xmlText(node) {
  return node?.textContent || '';
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function findZipEntry(bytes, name) {
  const decoder = new TextDecoder();
  for (let index = bytes.length - 22; index >= 0; index -= 1) {
    if (bytes[index] === 0x50 && bytes[index + 1] === 0x4b && bytes[index + 2] === 0x05 && bytes[index + 3] === 0x06) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const entries = view.getUint16(index + 10, true);
      let cursor = view.getUint32(index + 16, true);
      for (let entry = 0; entry < entries; entry += 1) {
        if (view.getUint32(cursor, true) !== 0x02014b50) break;
        const method = view.getUint16(cursor + 10, true);
        const compressedSize = view.getUint32(cursor + 20, true);
        const fileNameLength = view.getUint16(cursor + 28, true);
        const extraLength = view.getUint16(cursor + 30, true);
        const commentLength = view.getUint16(cursor + 32, true);
        const localOffset = view.getUint32(cursor + 42, true);
        const filename = decoder.decode(bytes.slice(cursor + 46, cursor + 46 + fileNameLength));
        if (filename === name) {
          const localNameLength = view.getUint16(localOffset + 26, true);
          const localExtraLength = view.getUint16(localOffset + 28, true);
          const dataStart = localOffset + 30 + localNameLength + localExtraLength;
          return { method, data: bytes.slice(dataStart, dataStart + compressedSize) };
        }
        cursor += 46 + fileNameLength + extraLength + commentLength;
      }
      break;
    }
  }
  return null;
}

async function readZipText(bytes, name) {
  const entry = findZipEntry(bytes, name);
  if (!entry) return '';
  if (entry.method === 0) return new TextDecoder().decode(entry.data);
  if (entry.method === 8) return new TextDecoder().decode(await inflateRaw(entry.data));
  throw new Error(`Unsupported XLSX compression method for ${name}`);
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  return [...doc.getElementsByTagName('si')].map(item => [...item.getElementsByTagName('t')].map(xmlText).join(''));
}

function parseWorkbookFirstSheet(xml, relationshipsXml) {
  const workbook = new DOMParser().parseFromString(xml, 'application/xml');
  const rels = new DOMParser().parseFromString(relationshipsXml, 'application/xml');
  const sheet = [...workbook.getElementsByTagName('sheet')][0];
  const relId = sheet?.getAttribute('r:id');
  const relationship = [...rels.getElementsByTagName('Relationship')].find(rel => rel.getAttribute('Id') === relId);
  const target = relationship?.getAttribute('Target') || 'worksheets/sheet1.xml';
  return `xl/${target.replace(/^\/?xl\//, '')}`;
}

function parseWorksheetRows(xml, sharedStrings) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const rows = [];
  [...doc.getElementsByTagName('row')].forEach(rowNode => {
    const row = [];
    [...rowNode.getElementsByTagName('c')].forEach(cell => {
      const reference = cell.getAttribute('r') || '';
      const index = reference ? excelColumnToIndex(reference) : row.length;
      const type = cell.getAttribute('t');
      const inline = [...cell.childNodes].find(node => stripXmlNamespace(node.nodeName) === 'is');
      const value = [...cell.childNodes].find(node => stripXmlNamespace(node.nodeName) === 'v');
      if (type === 's') row[index] = sharedStrings[Number(xmlText(value))] || '';
      else if (type === 'inlineStr') row[index] = [...inline?.childNodes || []].filter(node => stripXmlNamespace(node.nodeName) === 't').map(xmlText).join('');
      else row[index] = xmlText(value);
    });
    if (row.some(cell => cell)) rows.push(row.map(cell => String(cell || '').trim()));
  });
  return rows;
}

async function parseXlsx(file) {
  if (!('DecompressionStream' in window)) {
    throw new Error('This browser cannot read XLSX files yet. Export the sheet as CSV and import that file instead.');
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sharedStrings = parseSharedStrings(await readZipText(bytes, 'xl/sharedStrings.xml'));
  const sheetPath = parseWorkbookFirstSheet(
    await readZipText(bytes, 'xl/workbook.xml'),
    await readZipText(bytes, 'xl/_rels/workbook.xml.rels')
  );
  return parseWorksheetRows(await readZipText(bytes, sheetPath), sharedStrings);
}

function normalizedHeader(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function pick(row, headers, names) {
  const wanted = names.map(normalizedHeader);
  const index = headers.findIndex(header => wanted.includes(header));
  return index >= 0 ? row[index] || '' : '';
}

async function fileToRows(file) {
  const extension = file.name.split('.').pop().toLowerCase();
  if (extension === 'xlsx') return parseXlsx(file);
  if (extension === 'xls') throw new Error('Old .xls files are not supported. Save as .xlsx or CSV first.');
  return parseDelimited(await file.text());
}

function rowsToSpeakers(rows) {
  if (rows.length < 2) return [];
  const headers = rows[0].map(normalizedHeader);
  return rows.slice(1).map(row => {
    const first = pick(row, headers, ['first name', 'firstname']);
    const last = pick(row, headers, ['last name', 'lastname']);
    const name = pick(row, headers, ['name', 'full name', 'speaker', 'contact name']) || [first, last].filter(Boolean).join(' ');
    return {
      name,
      email: pick(row, headers, ['email', 'email address', 'speaker email', 'contact email']),
      specialty: pick(row, headers, ['specialty', 'speciality', 'topic', 'area', 'clinical area']),
      expertise: pick(row, headers, ['expertise', 'expertise area', 'areas of expertise', 'subspecialty']),
      institution: pick(row, headers, ['institution', 'organization', 'organisation', 'company', 'hospital', 'university']),
      faculty_profile_url: pick(row, headers, ['faculty profile url', 'profile url', 'url', 'website', 'link']),
      participation_history: pick(row, headers, ['participation history', 'previous participation', 'history', 'past events']),
      notes: pick(row, headers, ['notes', 'internal notes', 'comments'])
    };
  }).filter(speaker => speaker.name || speaker.email);
}

function spreadsheetToSpeakers(text) {
  return rowsToSpeakers(parseDelimited(text));
}

async function fileToSpeakers(file) {
  return rowsToSpeakers(await fileToRows(file));
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(filename, headers, rows) {
  const csv = [headers, ...rows].map(row => row.map(csvEscape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportDate() {
  return new Date().toISOString().slice(0, 10);
}

function exportSpeakersCsv(speakers) {
  if (!speakers.length) {
    toast('No speakers to export');
    return;
  }
  downloadCsv(`clinedpulse-speakers-${exportDate()}.csv`,
    ['name', 'email', 'specialty', 'expertise', 'institution', 'faculty_profile_url', 'participation_history', 'notes'],
    speakers.map(speaker => [
      speaker.name,
      speaker.email,
      speaker.specialty,
      speaker.expertise,
      speaker.institution,
      speaker.faculty_profile_url,
      speaker.participation_history,
      speaker.notes
    ])
  );
  toast(`Exported ${speakers.length} speakers`);
}

function exportEventsCsv(events) {
  if (!events.length) {
    toast('No events to export');
    return;
  }
  downloadCsv(`clinedpulse-events-${exportDate()}.csv`,
    ['event_name', 'event_type', 'speaker', 'date', 'time', 'topic', 'zoom_link', 'status', 'readiness_score', 'readiness_status', 'checklist_done', 'checklist_total'],
    events.map(event => [
      event.event_name,
      event.event_type,
      event.speaker || event.speaker_name,
      event.event_date,
      event.event_time,
      event.topic,
      event.zoom_link,
      event.status,
      event.readiness_score || 0,
      readinessState(event.readiness_score, Number(event.checklist_done || 0), Number(event.checklist_total || 0)).label,
      event.checklist_done || 0,
      event.checklist_total || 0
    ])
  );
  toast(`Exported ${events.length} events`);
}

function sampleImportCsv() {
  downloadCsv('clinedpulse-speaker-import-template.csv',
    ['name', 'email', 'specialty', 'expertise', 'institution', 'faculty_profile_url', 'participation_history', 'notes'],
    [['Dr. Avery Patel', '', 'Oncology', 'Community oncology education', 'Example University', 'https://example.edu/avery-patel', '2025 Summit speaker', 'Prefers email']]
  );
}

function sampleEventImportCsv() {
  downloadCsv('clinedpulse-event-import-template.csv',
    ['event_name', 'event_type', 'speaker', 'date', 'time', 'topic', 'zoom_link', 'status'],
    [['July Case Discussion', 'Case Discussion', 'Dr. John Doe', '2026-07-15', '13:00', 'Advances in AML', 'https://zoom.us/j/example', 'Planning']]
  );
}

function canonical(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function matchOption(value, values, fallback = '') {
  const key = canonical(value);
  return values.find(option => canonical(option) === key) || fallback;
}

function normalizeDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{5}(\.\d+)?$/.test(raw)) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    excelEpoch.setUTCDate(excelEpoch.getUTCDate() + Math.floor(Number(raw)));
    return excelEpoch.toISOString().slice(0, 10);
  }
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    const year = slash[3].length === 2 ? `20${slash[3]}` : slash[3];
    return `${year}-${slash[1].padStart(2, '0')}-${slash[2].padStart(2, '0')}`;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.valueOf()) ? raw : parsed.toISOString().slice(0, 10);
}

function normalizeTime(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const direct = raw.match(/^(\d{1,2}):(\d{2})/);
  if (direct) return `${direct[1].padStart(2, '0')}:${direct[2]}`;
  const twelveHour = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (!twelveHour) return raw;
  let hour = Number(twelveHour[1]);
  if (twelveHour[3].toLowerCase() === 'pm' && hour < 12) hour += 12;
  if (twelveHour[3].toLowerCase() === 'am' && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${twelveHour[2] || '00'}`;
}

function speakerMatcher(speakers) {
  const byName = new Map(speakers.map(speaker => [canonical(speaker.name), speaker]));
  const byEmail = new Map(speakers.map(speaker => [canonical(speaker.email), speaker]));
  return value => byEmail.get(canonical(value)) || byName.get(canonical(value));
}

function rowsToEvents(rows, speakers) {
  if (rows.length < 2) return [];
  const headers = rows[0].map(normalizedHeader);
  const findSpeaker = speakerMatcher(speakers);
  return rows.slice(1).map(row => {
    const speakerValue = pick(row, headers, ['speaker', 'speaker name', 'presenter', 'faculty', 'speaker email']);
    const speaker = findSpeaker(speakerValue);
    return {
      event_name: pick(row, headers, ['event name', 'event', 'name', 'title']),
      event_type: matchOption(pick(row, headers, ['event type', 'type']), eventTypes),
      speaker_id: speaker?.id || '',
      speaker_name: speaker?.name || speakerValue,
      speaker_lookup: speakerValue,
      event_date: normalizeDate(pick(row, headers, ['date', 'event date'])),
      event_time: normalizeTime(pick(row, headers, ['time', 'event time'])),
      topic: pick(row, headers, ['topic', 'event topic']),
      zoom_link: pick(row, headers, ['zoom link', 'zoom', 'meeting link', 'link']),
      status: matchOption(pick(row, headers, ['status', 'event status']), eventStatuses, 'Planning')
    };
  }).filter(event => event.event_name || event.speaker_lookup || event.event_date);
}

async function fileToEvents(file, speakers) {
  return rowsToEvents(await fileToRows(file), speakers);
}

function wireSpeakerRows() {
  $$('tr[data-id]').forEach(row => {
    row.onclick = () => showSpeaker(row.dataset.id);
    row.onpointerdown = event => {
      if (event.button !== 0) return;
      speakerDragCandidate = {
        id: Number(row.dataset.id),
        name: row.dataset.speakerName,
        hub: activeHub,
        mode: activeDataMode
      };
    };
    row.ondragstart = event => {
      row.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'copy';
      event.dataTransfer.setData('application/x-clinedpulse-speaker', JSON.stringify({
        id: Number(row.dataset.id),
        name: row.dataset.speakerName,
        hub: activeHub,
        mode: activeDataMode
      }));
    };
    row.ondragend = () => row.classList.remove('dragging');
  });
  $$('[data-queue-speaker]').forEach(button => {
    button.onclick = event => {
      event.stopPropagation();
      const row = button.closest('tr[data-id]');
      const count = queueSpeakerForEvent({ id: row.dataset.id, name: row.dataset.speakerName });
      toast(`${row.dataset.speakerName} queued · ${count} speaker${count === 1 ? '' : 's'} ready for Events`);
    };
  });
}

function wireSpeakerDropTarget() {
  const target = $('#eventsDropTarget');
  target.ondragover = event => {
    if (!Array.from(event.dataTransfer.types || []).includes('application/x-clinedpulse-speaker')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    target.classList.add('speaker-drop-ready');
  };
  target.ondragleave = () => target.classList.remove('speaker-drop-ready');
  target.ondrop = event => {
    event.preventDefault();
    target.classList.remove('speaker-drop-ready');
    try {
      const speaker = JSON.parse(event.dataTransfer.getData('application/x-clinedpulse-speaker'));
      if (speaker.hub !== activeHub || speaker.mode !== activeDataMode) {
        toast('Switch back to the speaker workspace where this drag started');
        return;
      }
      const count = queueSpeakerForEvent(speaker);
      toast(`${speaker.name} queued · ${count} speaker${count === 1 ? '' : 's'} ready for Events`);
    } catch {
      toast('That speaker could not be added');
    }
  };
  document.addEventListener('pointerup', event => {
    const speaker = speakerDragCandidate;
    speakerDragCandidate = null;
    if (!speaker || !event.target.closest?.('#eventsDropTarget')) return;
    if (speaker.hub !== activeHub || speaker.mode !== activeDataMode) return;
    const count = queueSpeakerForEvent(speaker);
    toast(`${speaker.name} queued · ${count} speaker${count === 1 ? '' : 's'} ready for Events`);
  });
}

function wireEventRows() {
  $$('[data-event-id]').forEach(row => {
    row.onclick = () => showEvent(row.dataset.eventId);
  });
}

async function updateEventStatus(event, status, options = {}) {
  const current = Array.isArray(event.speakers) ? event : await api(`/api/events/${event.id}`);
  const updated = await api(`/api/events/${event.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      ...current,
      speaker_ids: (current.speakers || []).map(speaker => speaker.id),
      status
    })
  });
  toast(`Status updated to ${status}`);
  if (options.refreshDetail) {
    await showEvent(event.id);
  } else if (location.hash.startsWith('#events')) {
    await eventsDashboard();
  } else {
    await overview();
  }
  return updated;
}

function wireStatusSelects(events, options = {}) {
  const byId = new Map(events.map(event => [String(event.id), event]));
  $$('[data-status-event-id]').forEach(select => {
    select.onclick = event => event.stopPropagation();
    select.onchange = async event => {
      event.stopPropagation();
      const selected = event.currentTarget;
      const rowEvent = byId.get(String(selected.dataset.statusEventId));
      if (!rowEvent || selected.value === rowEvent.status) return;
      const previous = rowEvent.status;
      selected.disabled = true;
      try {
        await updateEventStatus(rowEvent, selected.value, options);
      } catch (error) {
        selected.value = previous;
        selected.disabled = false;
        toast(error.message);
      }
    };
  });
}

async function overview() {
  activate('dashboard');
  $('#pageTitle').textContent = 'Operations overview';
  const data = await api('/api/overview');
  const speakers = data.speakers || { total: data.total, specialties: data.specialties, institutions: data.institutions };
  const events = data.events || { total: 0, upcoming: [], needsAttention: 0, completed: 0, statusCounts: [] };
  const tasks = events.tasks || { todo: [], urgent: [], upcoming: [] };
  const eventTotal = Number(events.total || 0);
  const statusRows = events.statusCounts.map(item => `
    <div class="status-row pipeline-row">
      <div><span>${escapeHtml(item.status)}</span><i style="width:${eventTotal ? Math.round((item.count / eventTotal) * 100) : 0}%"></i></div>
      <b>${item.count}</b>
    </div>`).join('');
  view.innerHTML = `
    <div class="hero-grid overview-metrics">
      <div class="metric"><small>LATER TASKS</small><strong>${tasks.todo.length}</strong><span>all other open tasks</span></div>
      <div class="metric"><small>UPCOMING TASKS</small><strong>${tasks.upcoming.length}</strong><span>due in 2-3 weeks</span></div>
      <div class="metric ${tasks.urgent.length ? 'alert' : ''}"><small>URGENT</small><strong>${tasks.urgent.length}</strong><span>due within one week</span></div>
    </div>
    <div class="grid-3">
      <div class="card task-card">
        <div class="card-head"><h2>Later to do</h2><span class="pill">ALL OTHER</span></div>
        ${taskRows(tasks.todo, 'green')}
      </div>
      <div class="card task-card">
        <div class="card-head"><h2>Upcoming</h2><span class="pill amber">2-3 WEEKS</span></div>
        ${taskRows(tasks.upcoming, 'amber')}
      </div>
      <div class="card task-card">
        <div class="card-head"><h2>Urgent</h2><span class="pill red">1 WEEK</span></div>
        ${taskRows(tasks.urgent, 'red')}
      </div>
    </div>
    <div class="hero-grid compact overview-metrics">
      <div class="metric"><small>SPEAKERS</small><strong>${speakers.total}</strong><span>profiles saved</span></div>
      <div class="metric"><small>TOTAL EVENTS</small><strong>${events.total}</strong><span>in the database</span></div>
      <div class="metric"><small>EVENTS COMPLETE</small><strong>${events.completed}</strong><span>finished events</span></div>
    </div>
    <div class="card status-dashboard">
      <div class="card-head"><h2>Event status pipeline</h2><a href="#events">FILTER EVENTS →</a></div>
      ${statusRows ? `<div class="status-list">${statusRows}</div>` : empty('Event statuses will appear here once events are added.', 'No event statuses')}
    </div>
    <div class="quick-grid">
      <a class="quick-card" href="#events?sort=closest_date">
        <small>EVENTS</small>
        <h3>Closest dates</h3>
        <p>Jump to events sorted by the dates closest to today.</p>
      </a>
      <a class="quick-card" href="#speakers">
        <small>SPEAKERS</small>
        <h3>Speaker history</h3>
        <p>Open speaker profiles with past events, covered topics, and scheduled programs.</p>
      </a>
    </div>`;
  wireEventRows();
}

function materialIcon(type) {
  return type === 'slides' ? 'PPT' : type === 'biography' ? 'BIO' : 'PDF';
}

function emailReviewCard(review) {
  const matched = review.event_id
    ? `<span class="review-match">Matched to <b>${escapeHtml(review.event_name)}</b>${review.event_date ? ` · ${formatEventDate(review.event_date)}` : ''}</span>`
    : '<span class="review-match warning">No matching speaker event found</span>';
  return `<article class="email-review-card" data-review-id="${review.id}">
    <span class="file-icon">${materialIcon(review.material_type)}</span>
    <div class="email-review-copy">
      <h3>${escapeHtml(review.title)}</h3>
      <p>${escapeHtml(review.subject || 'No subject')}</p>
      <small>From ${escapeHtml(review.sender_email)}${review.attachment_name ? ` · ${escapeHtml(review.attachment_name)}` : ''}</small>
      ${matched}
    </div>
    <div class="review-actions">
      <button class="button small" type="button" data-review-action="ignored">Ignore</button>
      <button class="button primary small" type="button" data-review-action="received" ${review.event_id ? '' : 'disabled'}>✓ Mark Received</button>
    </div>
  </article>`;
}

async function emailReviews() {
  activate('email');
  $('#pageTitle').textContent = 'Email material review';
  const reviews = await api('/api/email-materials');
  view.innerHTML = `
    <div class="section-head">
      <div><h2>Received-material notifications</h2><p>Review possible speaker materials before any event checklist is changed.</p></div>
    </div>
    <div class="card email-review-list">
      ${reviews.length ? reviews.map(emailReviewCard).join('') : empty('Potential slides, biographies, and consent forms will appear here for review.', 'No pending email materials')}
    </div>`;
  $$('[data-review-action]').forEach(button => {
    button.onclick = async () => {
      const card = button.closest('[data-review-id]');
      const action = button.dataset.reviewAction;
      card.querySelectorAll('button').forEach(item => { item.disabled = true; });
      try {
        const result = await api(`/api/email-materials/${card.dataset.reviewId}/review`, {
          method: 'PUT', body: JSON.stringify({ action })
        });
        toast(action === 'received' ? `${result.checklist_label} checked after review` : 'Notification ignored; no records changed');
        await emailReviews();
      } catch (error) {
        card.querySelectorAll('button').forEach(item => { item.disabled = false; });
        toast(error.message);
      }
    };
  });
}

async function directory() {
  activate('speakers');
  $('#pageTitle').textContent = 'Speaker directory';
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const query = params.get('q') || '';
  const searchBy = params.get('searchBy') || 'all';
  const sort = params.get('sort') || 'name_asc';
  const speakers = await api(`/api/speakers?q=${encodeURIComponent(query)}&searchBy=${encodeURIComponent(searchBy)}&sort=${encodeURIComponent(sort)}`);
  const rows = speakers.map(speakerRow).join('');
  view.innerHTML = `
    <div class="section-head">
      <div><h2>All speakers</h2><p>Search the directory, or drag speaker rows onto Events to build a multi-speaker event.</p></div>
      <div class="toolbar">
        <select id="searchBy" aria-label="Search field">
          <option value="all" ${searchBy === 'all' ? 'selected' : ''}>All fields</option>
          <option value="name" ${searchBy === 'name' ? 'selected' : ''}>Name</option>
          <option value="specialty" ${searchBy === 'specialty' ? 'selected' : ''}>Specialty</option>
          <option value="expertise" ${searchBy === 'expertise' ? 'selected' : ''}>Expertise</option>
          <option value="institution" ${searchBy === 'institution' ? 'selected' : ''}>Institution</option>
        </select>
        <select id="speakerSort" aria-label="Sort speakers">${optionPairs(speakerSortOptions, sort)}</select>
        <input class="input search" id="speakerSearch" type="search" value="${escapeHtml(query)}" placeholder="Search speakers">
        <button class="button" id="exportSpeakers" type="button">Export CSV</button>
        <button class="button" id="importSpeakers" type="button">Import speakers</button>
        <button class="button primary" id="addSpeaker">+ Add speaker</button>
      </div>
    </div>
    <div class="table-card">${rows ? `<table class="table"><thead><tr><th>SPEAKER</th><th>SPECIALTY</th><th>EXPERTISE</th><th>INSTITUTION</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : empty('Try a different search or add a new test profile.')}</div>`;

  let timer;
  const updateSearch = () => {
    const q = encodeURIComponent($('#speakerSearch').value);
    const by = encodeURIComponent($('#searchBy').value);
    const sortedBy = encodeURIComponent($('#speakerSort').value);
    location.hash = `speakers?q=${q}&searchBy=${by}&sort=${sortedBy}`;
    directory();
  };
  $('#speakerSearch').oninput = event => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      updateSearch();
    }, 250);
  };
  $('#searchBy').onchange = updateSearch;
  $('#speakerSort').onchange = updateSearch;
  $('#exportSpeakers').onclick = () => exportSpeakersCsv(speakers);
  $('#importSpeakers').onclick = () => importSpeakersModal();
  $('#addSpeaker').onclick = () => speakerForm();
  wireSpeakerRows();
}

async function eventsDashboard() {
  activate('events');
  $('#pageTitle').textContent = 'Event database';
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const month = params.get('month') || '';
  const type = params.get('type') || '';
  const status = params.get('status') || '';
  const sort = params.get('sort') || 'date_desc';
  const query = new URLSearchParams();
  if (month) query.set('month', month);
  if (type) query.set('type', type);
  if (status) query.set('status', status);
  query.set('sort', sort);
  const eventPath = `/api/events${query.toString() ? `?${query}` : ''}`;
  const events = await loadEvents(eventPath, { month, type, status, sort });
  const rows = events.map(eventRow).join('');
  const queued = queuedSpeakers();
  const queueBanner = queued.length ? `
    <div class="speaker-queue card">
      <div><b>${queued.length} speaker${queued.length === 1 ? '' : 's'} ready for an event</b><span>${queued.map(speaker => escapeHtml(speaker.name)).join(' · ')}</span></div>
      <div><button class="button" id="clearSpeakerQueue" type="button">Clear</button><button class="button primary" id="createQueuedEvent" type="button">Create event</button></div>
    </div>` : '';
  view.innerHTML = `
    ${queueBanner}
    <div class="section-head">
      <div><h2>Event dashboard</h2><p>Track every ClinEdPulse event from planning through follow-up.</p></div>
      <div class="toolbar">
        <input class="input" id="eventMonth" type="month" value="${escapeHtml(month)}" aria-label="Filter by month">
        <select id="eventType" aria-label="Filter by event type">${options(eventTypes, type, 'All event types')}</select>
        <select id="eventStatus" aria-label="Filter by status">${options(eventStatuses, status, 'All statuses')}</select>
        <select id="eventSort" aria-label="Sort events">${optionPairs(eventSortOptions, sort)}</select>
        <button class="button" id="clearEventFilters" type="button">Clear</button>
        <button class="button" id="exportEvents" type="button">Export CSV</button>
        <button class="button" id="importEvents" type="button">Import events</button>
        <button class="button primary" id="addEvent" type="button">+ Add event</button>
      </div>
    </div>
    <div class="table-card">${rows ? `<table class="table events-table"><thead><tr><th>EVENT</th><th>SPEAKER</th><th>DATE</th><th>STATUS</th><th>READINESS</th></tr></thead><tbody>${rows}</tbody></table>` : empty(activeDataMode === 'test' ? 'No test events match these filters.' : 'Real event data is empty right now. Turn on Test data to view the sample events.', 'No events yet')}</div>`;

  const applyFilters = () => {
    const next = new URLSearchParams();
    if ($('#eventMonth').value) next.set('month', $('#eventMonth').value);
    if ($('#eventType').value) next.set('type', $('#eventType').value);
    if ($('#eventStatus').value) next.set('status', $('#eventStatus').value);
    next.set('sort', $('#eventSort').value);
    location.hash = `events${next.toString() ? `?${next}` : ''}`;
    eventsDashboard();
  };
  $('#eventMonth').onchange = applyFilters;
  $('#eventType').onchange = applyFilters;
  $('#eventStatus').onchange = applyFilters;
  $('#eventSort').onchange = applyFilters;
  $('#clearEventFilters').onclick = () => {
    location.hash = 'events';
    eventsDashboard();
  };
  $('#exportEvents').onclick = () => exportEventsCsv(events);
  $('#importEvents').onclick = () => importEventsModal();
  $('#addEvent').onclick = () => eventForm();
  if ($('#clearSpeakerQueue')) $('#clearSpeakerQueue').onclick = () => {
    clearSpeakerQueue();
    eventsDashboard();
  };
  if ($('#createQueuedEvent')) $('#createQueuedEvent').onclick = () => eventForm();
  wireEventRows();
  wireStatusSelects(events);
}

async function calendlyIntegration() {
  activate('calendly');
  $('#pageTitle').textContent = 'Calendly integration';
  const status = await api('/api/calendly/status');
  const questionRows = status.required_questions.map(question => `
    <div class="status-row"><span>${escapeHtml(question)}</span><b>Field</b></div>`).join('');
  view.innerHTML = `
    <div class="section-head">
      <div><h2>Calendly automation</h2><p>Turn confirmed scheduling into event records, checklists, deadlines, and speaker history.</p></div>
      <div class="toolbar">
        <button class="button" id="copyWebhook" type="button">Copy webhook URL</button>
        <button class="button primary" id="runCalendlyTest" type="button">Create test booking</button>
      </div>
    </div>
    <div class="calendly-grid">
      <div class="handoff-card">
        <small>WEBHOOK URL</small>
        <h3>Calendly destination</h3>
        <input class="input integration-url" id="calendlyWebhookUrl" value="${escapeHtml(status.webhook_url)}" readonly>
      </div>
      <div class="handoff-card">
        <small>SECURITY</small>
        <h3>${status.signature_configured ? 'Signature enabled' : 'Signature optional'}</h3>
        <p>${status.signature_configured ? 'Incoming Calendly webhooks must match the configured signing secret.' : 'Local setup accepts unsigned test payloads. Add CALENDLY_WEBHOOK_SECRET before production use.'}</p>
      </div>
      <div class="handoff-card">
        <small>AUTOMATION</small>
        <h3>${escapeHtml(status.default_status)}</h3>
        <p>Bookings create or link the speaker, create the event, generate task deadlines, and check off Speaker Confirmed.</p>
      </div>
    </div>
    <div class="grid-2 no-top integration-row">
      <div class="card">
        <div class="card-head"><h2>Calendly questions</h2><span class="pill">MAPPING</span></div>
        <div class="status-list">${questionRows}</div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Workflow</h2><span class="pill">MODULE 7</span></div>
        <div class="integration-steps">
          <span><b>1</b> Physician schedules through Calendly</span>
          <span><b>2</b> Webhook posts an invitee.created booking</span>
          <span><b>3</b> ClinEdPulse creates the event and checklist</span>
          <span><b>4</b> Status becomes Speaker Confirmed</span>
        </div>
      </div>
    </div>`;
  $('#copyWebhook').onclick = async () => {
    await navigator.clipboard.writeText(status.webhook_url);
    toast('Webhook URL copied');
  };
  $('#runCalendlyTest').onclick = async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const result = await api('/api/calendly/test', { method: 'POST' });
      toast('Calendly test booking created');
      await showEvent(result.event.id);
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
    }
  };
}

function importPreview(rows = importRows) {
  const validCount = rows.filter(row => row.name && (!row.email || emailPattern.test(row.email))).length;
  const invalidCount = rows.length - validCount;
  const previewRows = rows.slice(0, 8).map(row => `<tr>
    <td>${escapeHtml(row.name || 'Missing name')}</td>
    <td>${escapeHtml(row.email || '—')}</td>
    <td>${escapeHtml(row.specialty || '—')}</td>
    <td>${escapeHtml(row.expertise || '—')}</td>
    <td>${escapeHtml(row.institution || '—')}</td>
  </tr>`).join('');
  return rows.length ? `
    <div class="import-summary">
      <span><b>${rows.length}</b> rows found</span>
      <span><b>${validCount}</b> ready</span>
      <span><b>${invalidCount}</b> needs cleanup</span>
    </div>
    <div class="table-card compact">${previewRows ? `<table class="table"><thead><tr><th>NAME</th><th>EMAIL</th><th>SPECIALTY</th><th>EXPERTISE</th><th>INSTITUTION</th></tr></thead><tbody>${previewRows}</tbody></table>` : ''}</div>
    <div class="modal-actions inline"><button class="button primary" id="runImport" type="button" ${validCount ? '' : 'disabled'}>Import ready rows</button></div>` : `
    <div class="empty small"><span>⇅</span><h3>No spreadsheet loaded</h3><p>Choose an XLSX or CSV file, or paste copied rows from a spreadsheet.</p></div>`;
}

function importSpeakersModal() {
  importRows = [];
  $('#modalForm').onsubmit = event => event.preventDefault();
  $('#modalBody').innerHTML = `
    <div class="modal-head">
      <h2>Import speakers</h2>
      <p>Load a spreadsheet, review the rows, then add the ready contacts to the speaker directory.</p>
    </div>
    <div class="import-modal-grid">
      <div class="import-panel">
        <div class="inline-head">
          <h3>Load contacts</h3>
          <button class="button small" id="downloadTemplate" type="button">Template</button>
        </div>
        <label class="file-drop" for="contactFile"><strong>Choose spreadsheet or CSV</strong><span>Supports .xlsx, .csv, .tsv, and pasted rows.</span></label>
        <input id="contactFile" type="file" accept=".xlsx,.csv,text/csv,.txt,.tsv" hidden>
        <textarea id="pasteRows" placeholder="Or paste rows from a spreadsheet here"></textarea>
        <div class="modal-actions inline">
          <button class="button" id="clearImport" type="button">Clear</button>
          <button class="button" id="parsePaste" type="button">Preview pasted rows</button>
        </div>
      </div>
      <div>
        <div class="inline-head preview-head">
          <h3>Preview</h3>
          <span class="pill gray" id="importState">Not started</span>
        </div>
        <div id="importPreview" class="import-panel">${importPreview([])}</div>
      </div>
    </div>`;
  modal.showModal();

  const renderPreview = rows => {
    importRows = rows;
    $('#importPreview').innerHTML = importPreview(rows);
    $('#importState').textContent = rows.length ? 'Ready to review' : 'Not started';
    $('#runImport')?.addEventListener('click', runImport);
  };
  $('#downloadTemplate').onclick = sampleImportCsv;
  $('#clearImport').onclick = () => {
    $('#pasteRows').value = '';
    renderPreview([]);
  };
  $('#parsePaste').onclick = () => renderPreview(spreadsheetToSpeakers($('#pasteRows').value));
  $('#contactFile').onchange = async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      renderPreview(await fileToSpeakers(file));
    } catch (error) {
      toast(error.message);
    }
  };
}

async function runImport() {
  const rows = importRows.filter(row => row.name && (!row.email || emailPattern.test(row.email)));
  $('#runImport').disabled = true;
  $('#runImport').textContent = 'Importing...';
  try {
    const result = await api('/api/speakers/import', { method: 'POST', body: JSON.stringify({ speakers: rows }) });
    toast(`Import finished: ${result.added} added, ${result.skipped} skipped, ${result.failed} failed`);
    importRows = [];
    modal.close();
    if (!location.hash.startsWith('#speakers')) location.hash = 'speakers';
    await directory();
  } catch (error) {
    toast(error.message);
    $('#runImport').disabled = false;
    $('#runImport').textContent = 'Import ready rows';
  }
}

function eventImportPreview(rows = eventImportRows) {
  const validCount = rows.filter(row => row.event_name).length;
  const invalidCount = rows.length - validCount;
  const previewRows = rows.slice(0, 8).map(row => `<tr>
    <td>${escapeHtml(row.event_name || 'Missing event')}</td>
    <td>${escapeHtml(row.speaker_name || row.speaker_lookup || 'Missing speaker')}</td>
    <td>${escapeHtml(row.event_date || 'Missing date')}</td>
    <td>${escapeHtml(row.status || 'Missing status')}</td>
  </tr>`).join('');
  return rows.length ? `
    <div class="import-summary">
      <span><b>${rows.length}</b> rows found</span>
      <span><b>${validCount}</b> ready</span>
      <span><b>${invalidCount}</b> needs cleanup</span>
    </div>
    <div class="table-card compact">${previewRows ? `<table class="table"><thead><tr><th>EVENT</th><th>SPEAKER</th><th>DATE</th><th>STATUS</th></tr></thead><tbody>${previewRows}</tbody></table>` : ''}</div>
    <div class="modal-actions inline"><button class="button primary" id="runEventImport" type="button" ${validCount ? '' : 'disabled'}>Import ready rows</button></div>` : `
    <div class="empty small"><span>⇅</span><h3>No spreadsheet loaded</h3><p>Choose an XLSX or CSV file, or paste copied event rows.</p></div>`;
}

async function importEventsModal() {
  const speakers = await api('/api/speakers');
  if (!speakers.length) {
    toast('Add speakers before importing events');
    return;
  }
  eventImportRows = [];
  $('#modalForm').onsubmit = event => event.preventDefault();
  $('#modalBody').innerHTML = `
    <div class="modal-head">
      <h2>Import events</h2>
      <p>Load event rows, match speakers by name or email, then add ready events to the dashboard.</p>
    </div>
    <div class="import-modal-grid">
      <div class="import-panel">
        <div class="inline-head">
          <h3>Load events</h3>
          <button class="button small" id="downloadEventTemplate" type="button">Template</button>
        </div>
        <label class="file-drop" for="eventFile"><strong>Choose spreadsheet or CSV</strong><span>Supports .xlsx, .csv, .tsv, and pasted rows.</span></label>
        <input id="eventFile" type="file" accept=".xlsx,.csv,text/csv,.txt,.tsv" hidden>
        <textarea id="pasteEventRows" placeholder="Or paste event rows from a spreadsheet here"></textarea>
        <div class="modal-actions inline">
          <button class="button" id="clearEventImport" type="button">Clear</button>
          <button class="button" id="parseEventPaste" type="button">Preview pasted rows</button>
        </div>
      </div>
      <div>
        <div class="inline-head preview-head">
          <h3>Preview</h3>
          <span class="pill gray" id="eventImportState">Not started</span>
        </div>
        <div id="eventImportPreview" class="import-panel">${eventImportPreview([])}</div>
      </div>
    </div>`;
  modal.showModal();

  const renderPreview = rows => {
    eventImportRows = rows;
    $('#eventImportPreview').innerHTML = eventImportPreview(rows);
    $('#eventImportState').textContent = rows.length ? 'Ready to review' : 'Not started';
    $('#runEventImport')?.addEventListener('click', runEventImport);
  };
  $('#downloadEventTemplate').onclick = sampleEventImportCsv;
  $('#clearEventImport').onclick = () => {
    $('#pasteEventRows').value = '';
    renderPreview([]);
  };
  $('#parseEventPaste').onclick = () => renderPreview(rowsToEvents(parseDelimited($('#pasteEventRows').value), speakers));
  $('#eventFile').onchange = async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      renderPreview(await fileToEvents(file, speakers));
    } catch (error) {
      toast(error.message);
    }
  };
}

async function runEventImport() {
  const rows = eventImportRows.filter(row => row.event_name);
  $('#runEventImport').disabled = true;
  $('#runEventImport').textContent = 'Importing...';
  try {
    const result = await api('/api/events/import', { method: 'POST', body: JSON.stringify({ events: rows }) });
    toast(`Import finished: ${result.added} added, ${result.skipped} skipped, ${result.failed} failed`);
    eventImportRows = [];
    modal.close();
    if (!location.hash.startsWith('#events')) location.hash = 'events';
    await eventsDashboard();
  } catch (error) {
    toast(error.message);
    $('#runEventImport').disabled = false;
    $('#runEventImport').textContent = 'Import ready rows';
  }
}

function selectField(name, label, values, selected = '', required = false, full = false, placeholder = '') {
  return `<div class="field ${full ? 'full' : ''}"><label>${label.toUpperCase()}</label><select name="${name}" ${required ? 'required' : ''}>${options(values, selected, placeholder)}</select></div>`;
}

function speakerSelectField(speakers, selectedIds = []) {
  const selected = new Set(selectedIds.map(String));
  const speakerOptions = speakers.map(speaker => `<label class="speaker-choice">
    <input type="checkbox" name="speaker_ids" value="${speaker.id}" ${selected.has(String(speaker.id)) ? 'checked' : ''}>
    <span><b>${escapeHtml(speaker.name)}</b><small>${escapeHtml([speaker.specialty, speaker.expertise].filter(Boolean).join(' · ') || speaker.institution || 'No details recorded')}</small></span>
  </label>`).join('');
  return `<div class="field full"><label>SPEAKERS <span class="optional-label">OPTIONAL · SELECT MULTIPLE</span></label>
    <div class="speaker-picker">${speakerOptions || '<p>No speakers in this workspace yet. You can still save the event.</p>'}</div>
  </div>`;
}

function checklistDueDateFields(event = {}) {
  const dueDates = new Map((event.checklist || []).map(item => [item.label, item.due_date || '']));
  return `<div class="field full"><label>CHECKLIST DUE DATES</label><div class="due-date-grid">
    ${checklistDueLabels.map(label => `<label><span>${escapeHtml(label)}</span><input class="input" type="date" name="due_${canonical(label)}" data-due-label="${escapeHtml(label)}" value="${escapeHtml(dueDates.get(label) || '')}"></label>`).join('')}
  </div><small class="field-help">Leave every due date blank to auto-space the checklist between today and the event date.</small></div>`;
}

async function eventForm(event = {}) {
  const speakers = await api('/api/speakers');
  const requestKey = event.request_key || crypto.randomUUID();
  const selectedSpeakerIds = event.id
    ? (event.speakers || []).map(speaker => speaker.id)
    : queuedSpeakers().map(speaker => speaker.id);
  $('#modalBody').innerHTML = `
    <div class="modal-head"><h2>${event.id ? 'Edit' : 'Add'} event</h2><p>Track ClinEdPulse events from planning through completion.</p></div>
    <div class="form-grid">
      ${field('event_name', 'Event name', event.event_name, true)}
      ${selectField('event_type', 'Event type', eventTypes, event.event_type, false, false, 'Choose type')}
      ${field('event_date', 'Date', event.event_date, false, 'date')}
      ${field('event_time', 'Time', event.event_time, false, 'time')}
      ${selectField('status', 'Status', eventStatuses, event.status || 'Planning', false, false)}
      ${speakerSelectField(speakers, selectedSpeakerIds)}
      ${field('topic', 'Topic', event.topic, false, 'textarea', true, 'Example: New treatment pathways for community oncology')}
      ${field('zoom_link', 'Zoom link', event.zoom_link, false, 'url', true, 'https://...')}
      ${checklistDueDateFields(event)}
    </div>
    <div class="modal-actions"><button class="button" id="cancelEventForm" type="button">Cancel</button><button class="button primary" id="saveEvent" type="submit">Save event</button></div>`;
  modal.showModal();
  $('#cancelEventForm').onclick = () => modal.close();
  $('#modalForm').onsubmit = async submitEvent => {
    submitEvent.preventDefault();
    const formData = new FormData(submitEvent.target);
    const body = Object.fromEntries(formData);
    body.speaker_ids = formData.getAll('speaker_ids');
    if (!event.id) body.request_key = requestKey;
    body.checklist_due_dates = {};
    $$('[data-due-label]').forEach(input => {
      body.checklist_due_dates[input.dataset.dueLabel] = input.value;
      delete body[input.name];
    });
    const saveButton = $('#saveEvent');
    saveButton.disabled = true;
    saveButton.textContent = 'Saving...';
    const finishSave = () => {
      modal.close();
      if (!event.id) clearSpeakerQueue();
      toast(`Event ${event.id ? 'updated' : 'added'}`);
      location.hash.startsWith('#events') ? eventsDashboard() : overview();
    };
    try {
      await api(event.id ? `/api/events/${event.id}` : '/api/events', {
        method: event.id ? 'PUT' : 'POST', body: JSON.stringify(body)
      });
      finishSave();
    } catch (error) {
      if (!event.id && error.message.includes('Could not reach') && await recoverCreatedEvent(body)) {
        finishSave();
        return;
      }
      saveButton.disabled = false;
      saveButton.textContent = 'Save event';
      toast(error.message.includes('Could not reach')
        ? 'Connection interrupted. Your event is still here—try Save again.'
        : error.message);
    }
  };
}

async function showEvent(id) {
  const event = await api(`/api/events/${id}`);
  const total = Number(event.checklist_total || event.checklist?.length || 0);
  const done = Number(event.checklist_done || event.checklist?.filter(item => item.completed).length || 0);
  const score = Number(event.readiness_score || 0);
  $('#modalBody').innerHTML = `
    <div class="event-modal">
    <div class="profile-card"><span class="avatar">◷</span><h2>${escapeHtml(event.event_name)}</h2><p>${escapeHtml(event.event_type)} · <span id="checklistCount">${done}/${total || 12}</span> checklist items done</p><div class="event-status-control">${statusSelect(event, false)}</div><div class="event-readiness" id="eventReadiness">${readiness(score, done, total || 12)}</div></div>
    <div class="detail-body"><h3>Speakers</h3><p>${escapeHtml(event.speaker || event.speaker_name || 'No speakers recorded')}</p></div>
    <div class="detail-body"><h3>Date and time</h3><p>${formatEventDate(event.event_date)}${event.event_time ? ` at ${escapeHtml(event.event_time)}` : ''}</p></div>
    <div class="detail-body"><h3>Topic</h3><p>${escapeHtml(event.topic || 'No topic recorded.')}</p></div>
    <div class="detail-body"><h3>Zoom link</h3><p>${event.zoom_link ? `<a href="${escapeHtml(event.zoom_link)}" target="_blank" rel="noreferrer">Open Zoom link ↗</a>` : 'No Zoom link recorded.'}</p></div>
    <div class="detail-body"><h3>Operations checklist</h3>${checklistView(event)}</div>
    </div>
    <div class="modal-actions"><button class="button danger" type="button" id="deleteEvent">Delete event</button><button class="button" type="button" id="editEvent">Edit event</button><button class="button primary" type="button" id="closeEvent">Done</button></div>`;
  if (!modal.open) modal.showModal();
  wireStatusSelects([event], { refreshDetail: true });
  $$('[data-checklist-id]').forEach(input => {
    input.onchange = async () => {
      const previous = !input.checked;
      const check = input.closest('.check');
      const label = check?.querySelector('span');
      const state = check?.querySelector('small');
      const applyState = checked => {
        input.checked = checked;
        label?.classList.toggle('done', checked);
        if (state) state.textContent = checked ? 'Done' : taskDueText(input.dataset.dueDate);
        const nextDone = $$('[data-checklist-id]').filter(item => item.checked).length;
        updateChecklistCount(event.id, nextDone, total);
      };
      applyState(input.checked);
      input.disabled = true;
      try {
        const updated = await api(`/api/events/${event.id}/checklist/${input.dataset.checklistId}`, {
          method: 'PUT',
          body: JSON.stringify({ completed: input.checked })
        });
        updateChecklistCount(event.id, Number(updated.checklist_done || 0), Number(updated.checklist_total || total), Number(updated.readiness_score || 0));
        input.disabled = false;
      } catch (error) {
        applyState(previous);
        input.disabled = false;
        toast(error.message);
      }
    };
  });
  $('#closeEvent').onclick = () => modal.close();
  $('#editEvent').onclick = () => eventForm(event);
  $('#deleteEvent').onclick = async () => {
    if (!confirm(`Delete ${event.event_name}? This cannot be undone.`)) return;
    try {
      await api(`/api/events/${event.id}`, { method: 'DELETE' });
      modal.close();
      toast('Event deleted');
      eventsDashboard();
    } catch (error) { toast(error.message); }
  };
}

async function showSpeaker(id) {
  const speaker = await api(`/api/speakers/${id}`);
  $('#modalBody').innerHTML = `
    <div class="profile-card">${avatar(speaker)}<h2>${escapeHtml(speaker.name)}</h2><p>${escapeHtml(speaker.specialty || 'Specialty not recorded')} · ${escapeHtml(speaker.institution || 'Institution not recorded')}</p></div>
    <div class="detail-body"><h3>Expertise</h3><p>${escapeHtml(speaker.expertise || 'No expertise recorded.')}</p></div>
    <div class="detail-body"><h3>Contact</h3><p>${escapeHtml(speaker.email || 'No email recorded.')}</p>${speaker.faculty_profile_url ? `<p><a href="${escapeHtml(speaker.faculty_profile_url)}" target="_blank" rel="noreferrer">Open faculty profile ↗</a></p>` : ''}</div>
    <div class="detail-body"><h3>Speaker history</h3>${speakerHistoryView(speaker)}</div>
    <div class="detail-body"><h3>Previous participation notes</h3><p>${escapeHtml(speaker.participation_history || 'No previous participation notes recorded.')}</p></div>
    <div class="detail-body"><h3>Internal notes</h3><p>${escapeHtml(speaker.notes || 'No internal notes.')}</p></div>
    <div class="modal-actions"><button class="button danger" type="button" id="deleteSpeaker">Delete speaker</button><button class="button" type="button" id="editSpeaker">Edit profile</button><button class="button primary" type="button" id="closeProfile">Done</button></div>`;
  modal.showModal();
  $$('.history-event[data-event-id]').forEach(row => {
    row.onclick = () => {
      modal.close();
      showEvent(row.dataset.eventId);
    };
  });
  $('#closeProfile').onclick = () => modal.close();
  $('#editSpeaker').onclick = () => speakerForm(speaker);
  $('#deleteSpeaker').onclick = async () => {
    if (!confirm(`Delete ${speaker.name}? This cannot be undone.`)) return;
    try {
      await api(`/api/speakers/${speaker.id}`, { method: 'DELETE' });
      modal.close();
      toast('Speaker deleted');
      location.hash.startsWith('#speakers') ? directory() : overview();
    } catch (error) { toast(error.message); }
  };
}

function field(name, label, value = '', required = false, type = 'text', full = false, placeholder = '') {
  return `<div class="field ${full ? 'full' : ''}"><label>${label.toUpperCase()}</label>${type === 'textarea'
    ? `<textarea name="${name}" placeholder="${escapeHtml(placeholder)}" ${required ? 'required' : ''}>${escapeHtml(value)}</textarea>`
    : `<input class="input" name="${name}" type="${type}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" ${required ? 'required' : ''}>`}</div>`;
}

function speakerForm(speaker = {}) {
  $('#modalBody').innerHTML = `
    <div class="modal-head"><h2>${speaker.id ? 'Edit' : 'Add'} speaker</h2><p>Enter information collected from emails, faculty pages, or existing ClinEdPulse records.</p></div>
    <div class="form-grid">
      ${field('name', 'Full name', speaker.name, true)}
      ${field('email', 'Email', speaker.email, false, 'email')}
      ${field('specialty', 'Specialty', speaker.specialty)}
      ${field('expertise', 'Expertise', speaker.expertise, false, 'textarea', true, 'Examples: CAR-T therapy, AML, survivorship care')}
      ${field('institution', 'Institution', speaker.institution)}
      ${field('faculty_profile_url', 'Faculty profile URL', speaker.faculty_profile_url, false, 'url')}
      ${field('participation_history', 'Previous participation history', speaker.participation_history, false, 'textarea', true, 'Example: Participated in 2025 Summit')}
      ${field('notes', 'Internal notes', speaker.notes, false, 'textarea', true, 'Examples: Prefers email communication; interested in hematologic malignancies')}
    </div>
    <div class="modal-actions"><button class="button" id="cancelSpeakerForm" type="button">Cancel</button><button class="button primary" type="submit">Save speaker</button></div>`;
  modal.showModal();
  $('#cancelSpeakerForm').onclick = () => modal.close();
  $('#modalForm').onsubmit = async event => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.target));
    try {
      await api(speaker.id ? `/api/speakers/${speaker.id}` : '/api/speakers', {
        method: speaker.id ? 'PUT' : 'POST', body: JSON.stringify(body)
      });
      modal.close();
      toast(`Speaker ${speaker.id ? 'updated' : 'added'}`);
      location.hash.startsWith('#speakers') ? directory() : overview();
    } catch (error) { toast(error.message); }
  };
}

async function router() {
  try {
    if (location.hash.startsWith('#speakers')) await directory();
    else if (location.hash.startsWith('#events')) await eventsDashboard();
    else if (location.hash.startsWith('#email')) await emailReviews();
    else await overview();
  } catch (error) {
    console.error('Route load failed', error);
    view.innerHTML = `<div class="status-page"><h2>We hit a snag</h2><p>${escapeHtml(error.message)}</p><button class="button primary" id="retryRoute" type="button">Try again</button></div>`;
    $('#retryRoute').onclick = () => router();
  }
}

$('#today').textContent = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
setHub(localStorage.getItem('clinedpulse-hub'));
setDataMode(activeDataMode);
$$('.hub-option').forEach(button => {
  button.addEventListener('click', () => setHub(button.dataset.hub, true));
});
$('#testModeToggle').addEventListener('click', () => {
  setDataMode(activeDataMode === 'test' ? 'live' : 'test', true);
});
$('#modalClose').onclick = () => modal.close();
wireSpeakerDropTarget();
updateSpeakerQueueBadge();
document.addEventListener('click', event => {
  if (event.target.matches('[data-action="new-speaker"]')) speakerForm();
});
window.addEventListener('hashchange', router);
router();
