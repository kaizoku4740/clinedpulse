const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const view = $('#view');
const modal = $('#modal');

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[char]));
const initials = name => (name || '?').split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase();
const avatar = speaker => `<span class="avatar">${initials(speaker.name)}</span>`;

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { 'content-type': 'application/json' }, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  setTimeout(() => element.classList.remove('show'), 2500);
}

function empty(message) {
  return `<div class="empty"><span>✦</span><h3>No speakers yet</h3><p>${escapeHtml(message)}</p></div>`;
}

function activate(route) {
  $$('[data-route]').forEach(link => link.classList.toggle('active', link.dataset.route === route));
}

function speakerRow(speaker) {
  return `<tr data-id="${speaker.id}">
    <td><div class="person">${avatar(speaker)}<div><b>${escapeHtml(speaker.name)}</b><small>${escapeHtml(speaker.email)}</small></div></div></td>
    <td>${escapeHtml(speaker.specialty || '—')}</td>
    <td>${escapeHtml(speaker.institution || '—')}</td>
    <td>›</td>
  </tr>`;
}

function wireSpeakerRows() {
  $$('tr[data-id]').forEach(row => {
    row.onclick = () => showSpeaker(row.dataset.id);
  });
}

async function overview() {
  activate('dashboard');
  $('#pageTitle').textContent = 'Speaker database';
  const data = await api('/api/overview');
  const rows = data.recent.map(speakerRow).join('');
  view.innerHTML = `
    <div class="hero-grid" style="grid-template-columns:repeat(3,1fr)">
      <div class="metric"><small>TOTAL SPEAKERS</small><strong>${data.total}</strong><span>profiles saved</span></div>
      <div class="metric"><small>SPECIALTIES</small><strong>${data.specialties}</strong><span>represented</span></div>
      <div class="metric"><small>INSTITUTIONS</small><strong>${data.institutions}</strong><span>represented</span></div>
    </div>
    <div class="card" style="margin-top:18px">
      <div class="card-head"><h2>Recently added speakers</h2><a href="#speakers">VIEW DIRECTORY →</a></div>
      ${rows ? `<table class="table"><thead><tr><th>SPEAKER</th><th>SPECIALTY</th><th>INSTITUTION</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : empty('Add a placeholder speaker to begin testing.')}
    </div>`;
  wireSpeakerRows();
}

async function directory() {
  activate('speakers');
  $('#pageTitle').textContent = 'Speaker directory';
  const query = new URLSearchParams(location.hash.split('?')[1] || '').get('q') || '';
  const speakers = await api(`/api/speakers?q=${encodeURIComponent(query)}`);
  const rows = speakers.map(speakerRow).join('');
  view.innerHTML = `
    <div class="section-head">
      <div><h2>All speakers</h2><p>Search by name, specialty, or institution.</p></div>
      <div class="toolbar"><input class="input search" id="speakerSearch" type="search" value="${escapeHtml(query)}" placeholder="Search speakers"><button class="button primary" id="addSpeaker">+ Add speaker</button></div>
    </div>
    <div class="table-card">${rows ? `<table class="table"><thead><tr><th>SPEAKER</th><th>SPECIALTY</th><th>INSTITUTION</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : empty('Try a different search or add a new test profile.')}</div>`;

  let timer;
  $('#speakerSearch').oninput = event => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      location.hash = `speakers?q=${encodeURIComponent(event.target.value)}`;
      directory();
    }, 250);
  };
  $('#addSpeaker').onclick = () => speakerForm();
  wireSpeakerRows();
}

async function showSpeaker(id) {
  const speaker = await api(`/api/speakers/${id}`);
  $('#modalBody').innerHTML = `
    <div class="profile-card">${avatar(speaker)}<h2>${escapeHtml(speaker.name)}</h2><p>${escapeHtml(speaker.specialty || 'Specialty not recorded')} · ${escapeHtml(speaker.institution || 'Institution not recorded')}</p></div>
    <div class="detail-body"><h3>Contact</h3><p>${escapeHtml(speaker.email)}</p>${speaker.faculty_profile_url ? `<p><a href="${escapeHtml(speaker.faculty_profile_url)}" target="_blank" rel="noreferrer">Open faculty profile ↗</a></p>` : ''}</div>
    <div class="detail-body"><h3>Previous participation</h3><p>${escapeHtml(speaker.participation_history || 'No previous participation recorded.')}</p></div>
    <div class="detail-body"><h3>Internal notes</h3><p>${escapeHtml(speaker.notes || 'No internal notes.')}</p></div>
    <div class="modal-actions"><button class="button danger" type="button" id="deleteSpeaker">Delete speaker</button><button class="button" type="button" id="editSpeaker">Edit profile</button><button class="button primary" type="button" id="closeProfile">Done</button></div>`;
  modal.showModal();
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
      ${field('email', 'Email', speaker.email, true, 'email')}
      ${field('specialty', 'Specialty', speaker.specialty)}
      ${field('institution', 'Institution', speaker.institution)}
      ${field('faculty_profile_url', 'Faculty profile URL', speaker.faculty_profile_url, false, 'url')}
      ${field('participation_history', 'Previous participation history', speaker.participation_history, false, 'textarea', true, 'Example: Participated in 2025 Summit')}
      ${field('notes', 'Internal notes', speaker.notes, false, 'textarea', true, 'Examples: Prefers email communication; interested in hematologic malignancies')}
    </div>
    <div class="modal-actions"><button class="button" value="cancel">Cancel</button><button class="button primary" type="submit">Save speaker</button></div>`;
  modal.showModal();
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
    location.hash.startsWith('#speakers') ? await directory() : await overview();
  } catch (error) {
    view.innerHTML = `<div class="status-page"><h2>We hit a snag</h2><p>${escapeHtml(error.message)}</p></div>`;
  }
}

$('#today').textContent = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
document.addEventListener('click', event => {
  if (event.target.matches('[data-action="new-speaker"]')) speakerForm();
});
window.addEventListener('hashchange', router);
router();
