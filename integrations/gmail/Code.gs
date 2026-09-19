const CLINEDPULSE_WEBHOOK_URL = 'https://clinedpulse-speaker-database.kaizoku4740.workers.dev/api/email-materials/ingest';
const MONITORED_EMAIL = 'buggydclown4740@gmail.com';
const SCAN_FUNCTION = 'scanRelevantEmails';

function scanRelevantEmails() {
  const properties = PropertiesService.getScriptProperties();
  const secret = properties.getProperty('CLINEDPULSE_INGEST_SECRET');
  if (!secret) throw new Error('Add CLINEDPULSE_INGEST_SECRET in Project Settings > Script properties.');

  const startedAt = Date.now();
  const lastScan = Number(properties.getProperty('LAST_SCAN_MS') || startedAt - 10 * 60 * 1000);
  const cutoff = lastScan - 10 * 60 * 1000;
  const query = 'in:inbox newer_than:2d {has:attachment subject:slides subject:presentation subject:biography subject:bio subject:consent subject:release}';
  const threads = GmailApp.search(query, 0, 50);

  threads.forEach(function(thread) {
    thread.getMessages().forEach(function(message) {
      if (message.getDate().getTime() <= cutoff) return;
      const attachments = message.getAttachments({ includeInlineImages: false, includeAttachments: true }).map(function(file) {
        return { filename: file.getName(), mimeType: file.getContentType() };
      });
      const email = {
        message_key: 'gmail:' + message.getId(),
        sender_email: message.getFrom(),
        recipient_email: MONITORED_EMAIL,
        subject: message.getSubject(),
        text: message.getPlainBody().slice(0, 5000),
        attachments: attachments
      };
      if (!looksLikeSpeakerMaterial(email)) return;
      postSignedEmail(email, secret);
    });
  });

  properties.setProperty('LAST_SCAN_MS', String(startedAt));
}
function looksLikeSpeakerMaterial(email) {
  const context = (email.subject + '\n' + email.text).toLowerCase();
  return email.attachments.some(function(attachment) {
    const name = (attachment.filename || '').toLowerCase();
    const mime = (attachment.mimeType || '').toLowerCase();
    if (/\.(ppt|pptx|pps|ppsx|key)$/.test(name) || /slide|deck|presentation/.test(name) || mime.indexOf('presentation') >= 0) return true;
    if (/consent|release|authorization|permission/.test(name)) return true;
    if (/biograph|(^|[\s_.-])bio([\s_.-]|$)|curriculum[\s_-]*vitae|(^|[\s_.-])cv([\s_.-]|$)/.test(name)) return true;
    if (/\.(pdf|doc|docx|rtf|txt)$/.test(name) && /consent|release|authorization|biograph|speaker bio|\bbio\b|slide|deck|presentation/.test(context)) return true;
    return false;
  }) || (!email.attachments.length && /biograph|speaker bio|\bbio\b/.test(email.subject.toLowerCase()) && email.text.trim().length >= 80);
}

function postSignedEmail(email, secret) {
  const body = JSON.stringify(email);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const bytes = Utilities.computeHmacSha256Signature(timestamp + '.' + body, secret, Utilities.Charset.UTF_8);
  const signature = bytes.map(function(byte) {
    return ('0' + (byte & 255).toString(16)).slice(-2);
  }).join('');
  const response = UrlFetchApp.fetch(CLINEDPULSE_WEBHOOK_URL, {
    method: 'post',
    contentType: 'application/json',
    payload: body,
    headers: {
      'X-ClinEdPulse-Timestamp': timestamp,
      'X-ClinEdPulse-Signature': signature
    },
    muteHttpExceptions: true
  });
  const status = response.getResponseCode();
  if (status < 200 || status >= 300) throw new Error('ClinEdPulse webhook returned HTTP ' + status + ': ' + response.getContentText());
}

function installEmailMonitor() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === SCAN_FUNCTION) ScriptApp.deleteTrigger(trigger);
  });
  PropertiesService.getScriptProperties().setProperty('LAST_SCAN_MS', String(Date.now()));
  ScriptApp.newTrigger(SCAN_FUNCTION).timeBased().everyMinutes(5).create();
}
