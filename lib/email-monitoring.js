const materialTypes = {
  slides: { label: 'Slides Received', name: 'Slides' },
  biography: { label: 'Bio Collected', name: 'Biography' },
  consent_form: { label: 'Consent Form Received', name: 'Consent Form' }
};

const documentExtension = /\.(pdf|doc|docx|rtf|txt)$/i;
const slideExtension = /\.(ppt|pptx|pps|ppsx|key)$/i;

export function normalizeEmailAddress(value = '') {
  const match = String(value).match(/<([^>]+)>/);
  return (match?.[1] || value).trim().toLowerCase();
}
export function detectEmailMaterials({ subject = '', text = '', attachments = [] } = {}) {
  const context = `${subject}\n${text}`.toLowerCase();
  const detected = new Map();
  const add = (type, attachmentName = '') => {
    if (!detected.has(type)) {
      detected.set(type, { type, ...materialTypes[type], attachment_name: attachmentName });
    }
  };

  for (const attachment of attachments || []) {
    const name = String(attachment.filename || attachment.name || '').trim();
    const lowerName = name.toLowerCase();
    const mime = String(attachment.mimeType || attachment.contentType || '').toLowerCase();

    if (/consent|release|authorization|permission/.test(lowerName)) {
      add('consent_form', name);
      continue;
    }
    if (/biograph|(^|[\s_.-])bio([\s_.-]|$)|curriculum[\s_-]*vitae|(^|[\s_.-])cv([\s_.-]|$)/.test(lowerName)) {
      add('biography', name);
      continue;
    }
    if (slideExtension.test(lowerName) || /slide|deck|presentation/.test(lowerName) || mime.includes('presentation')) {
      add('slides', name);
      continue;
    }
    if (documentExtension.test(lowerName) && /consent|release|authorization/.test(context)) {
      add('consent_form', name);
      continue;
    }
    if (documentExtension.test(lowerName) && /biograph|speaker bio|\bbio\b/.test(context)) {
      add('biography', name);
      continue;
    }
    if (/\.pdf$/i.test(lowerName) && /slide|deck|presentation/.test(context)) {
      add('slides', name);
    }
  }

  if (!attachments?.length && /biograph|speaker bio|\bbio\b/.test(subject.toLowerCase()) && text.trim().length >= 80) {
    add('biography');
  }

  return [...detected.values()];
}

export function materialNotificationTitle(materialName, speakerName) {
  return `Potential ${materialName} Received for ${speakerName || 'Unknown Speaker'}`;
}
