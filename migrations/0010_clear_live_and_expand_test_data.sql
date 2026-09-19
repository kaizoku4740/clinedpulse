-- Temporarily clear all live workspace data while preserving the isolated
-- test workspaces. The test rows below are entirely fictional.
DELETE FROM email_material_reviews
WHERE hub_key IN ('heme','endo','gastro');

DELETE FROM event_checklist_items
WHERE event_id IN (
  SELECT id FROM events WHERE hub_key IN ('heme','endo','gastro')
);

DELETE FROM events
WHERE hub_key IN ('heme','endo','gastro');

DELETE FROM speakers
WHERE hub_key IN ('heme','endo','gastro');

INSERT OR IGNORE INTO speakers
  (name,email,institution,specialty,faculty_profile_url,notes,participation_history,hub_key)
VALUES
  ('Dr. Aisha Rahman','test.heme.aisha@example.test','Redwood Hematology Institute','Leukemia','','Fictional test-mode speaker.','2025 Test Leukemia Workshop','test-heme'),
  ('Dr. Benjamin Cole','test.heme.benjamin@example.test','Summit Cancer Center','Lymphoma','','Fictional test-mode speaker.','','test-heme'),
  ('Dr. Sofia Martinez','test.heme.sofia@example.test','Horizon Cellular Therapy','Transplantation','','Fictional test-mode speaker.','2025 Test Transplant Forum','test-heme'),
  ('Dr. Ethan Brooks','test.heme.ethan@example.test','Metro Blood Disorders Center','Benign Hematology','','Fictional test-mode speaker.','','test-heme'),
  ('Dr. Hannah Kim','test.endo.hannah@example.test','Valley Endocrine Center','Thyroid Disorders','','Fictional test-mode speaker.','2025 Test Thyroid Symposium','test-endo'),
  ('Dr. Daniel Foster','test.endo.daniel@example.test','Oakridge Medical Group','Pituitary Disorders','','Fictional test-mode speaker.','','test-endo'),
  ('Dr. Amara Okafor','test.endo.amara@example.test','Crescent Diabetes Institute','Diabetes Technology','','Fictional test-mode speaker.','2025 Test Diabetes Technology Lab','test-endo'),
  ('Dr. Leo Bennett','test.endo.leo@example.test','Grandview University Hospital','Adrenal Disorders','','Fictional test-mode speaker.','','test-endo'),
  ('Dr. Isabel Torres','test.gastro.isabel@example.test','Riverbend Digestive Institute','Inflammatory Bowel Disease','','Fictional test-mode speaker.','2025 Test IBD Exchange','test-gastro'),
  ('Dr. Julian Wright','test.gastro.julian@example.test','Pinecrest Liver Center','Hepatology','','Fictional test-mode speaker.','','test-gastro'),
  ('Dr. Nia Campbell','test.gastro.nia@example.test','Seaside Academic Health','Advanced Endoscopy','','Fictional test-mode speaker.','2025 Test Endoscopy Lab','test-gastro'),
  ('Dr. Samuel Lee','test.gastro.samuel@example.test','Highland GI Center','Motility Disorders','','Fictional test-mode speaker.','','test-gastro');

INSERT OR IGNORE INTO events
  (event_name,event_type,speaker_id,speaker_name,event_date,event_time,topic,zoom_link,status,hub_key)
VALUES
  ('Heme Test AML Case Exchange','Case Discussion',(SELECT id FROM speakers WHERE email='test.heme.aisha@example.test'),'Dr. Aisha Rahman',date('now','+7 days'),'12:00','AML treatment sequencing','','Planning','test-heme'),
  ('Heme Test Lymphoma Tumor Board','Tumor Board',(SELECT id FROM speakers WHERE email='test.heme.benjamin@example.test'),'Dr. Benjamin Cole',date('now','+21 days'),'13:00','Relapsed lymphoma case review','','Speaker Invited','test-heme'),
  ('Heme Test CAR-T Operations Lab','Faculty Workshop',(SELECT id FROM speakers WHERE email='test.heme.sofia@example.test'),'Dr. Sofia Martinez',date('now','+35 days'),'14:30','Cellular therapy operations','https://zoom.example.test/heme-cart','Zoom Scheduled','test-heme'),
  ('Heme Test Transplant Complications Roundtable','Roundtable',(SELECT id FROM speakers WHERE email='test.heme.sofia@example.test'),'Dr. Sofia Martinez',date('now','+50 days'),'15:00','Managing transplant complications','https://zoom.example.test/heme-transplant','Event Ready','test-heme'),
  ('Heme Test Benign Hematology Update','Webinar',(SELECT id FROM speakers WHERE email='test.heme.ethan@example.test'),'Dr. Ethan Brooks',date('now','-45 days'),'11:00','Complex anticoagulation decisions','https://zoom.example.test/heme-benign','Follow-Up Complete','test-heme'),
  ('Heme Test Myeloma Conference Debrief','Conference Debrief',(SELECT id FROM speakers WHERE email='test.heme.benjamin@example.test'),'Dr. Benjamin Cole',date('now','-12 days'),'12:30','Practice-changing myeloma data','https://zoom.example.test/heme-myeloma','Completed','test-heme'),

  ('Endo Test Thyroid Nodule Case Lab','Case Discussion',(SELECT id FROM speakers WHERE email='test.endo.hannah@example.test'),'Dr. Hannah Kim',date('now','+5 days'),'09:00','Thyroid nodule workup','','Planning','test-endo'),
  ('Endo Test Diabetes Technology Roundtable','Roundtable',(SELECT id FROM speakers WHERE email='test.endo.amara@example.test'),'Dr. Amara Okafor',date('now','+16 days'),'13:00','Integrating diabetes technology','','Speaker Confirmed','test-endo'),
  ('Endo Test Pituitary Imaging Workshop','Faculty Workshop',(SELECT id FROM speakers WHERE email='test.endo.daniel@example.test'),'Dr. Daniel Foster',date('now','+28 days'),'14:00','Pituitary imaging decisions','https://zoom.example.test/endo-pituitary','Zoom Scheduled','test-endo'),
  ('Endo Test Adrenal Disorders Summit','Summit Session',(SELECT id FROM speakers WHERE email='test.endo.leo@example.test'),'Dr. Leo Bennett',date('now','+42 days'),'15:30','Adrenal incidentaloma pathways','https://zoom.example.test/endo-adrenal','Event Ready','test-endo'),
  ('Endo Test Obesity Care Update','Webinar',(SELECT id FROM speakers WHERE email='test.endo.priya@example.test'),'Dr. Priya Shah',date('now','-35 days'),'10:00','Multidisciplinary obesity care','https://zoom.example.test/endo-obesity','Follow-Up Complete','test-endo'),
  ('Endo Test Bone Health Debrief','Conference Debrief',(SELECT id FROM speakers WHERE email='test.endo.luis@example.test'),'Dr. Luis Rivera',date('now','-10 days'),'12:00','New evidence in metabolic bone health','https://zoom.example.test/endo-bone','Completed','test-endo'),

  ('Gastro Test IBD Case Exchange','Case Discussion',(SELECT id FROM speakers WHERE email='test.gastro.isabel@example.test'),'Dr. Isabel Torres',date('now','+6 days'),'11:30','Complex IBD treatment sequencing','','Speaker Invited','test-gastro'),
  ('Gastro Test Liver Disease Update','Webinar',(SELECT id FROM speakers WHERE email='test.gastro.julian@example.test'),'Dr. Julian Wright',date('now','+15 days'),'12:00','Contemporary liver disease management','','Speaker Confirmed','test-gastro'),
  ('Gastro Test Advanced Endoscopy Workshop','Faculty Workshop',(SELECT id FROM speakers WHERE email='test.gastro.nia@example.test'),'Dr. Nia Campbell',date('now','+24 days'),'14:00','Advanced endoscopy case planning','https://zoom.example.test/gastro-endoscopy','Materials Pending','test-gastro'),
  ('Gastro Test Motility Disorders Forum','Roundtable',(SELECT id FROM speakers WHERE email='test.gastro.samuel@example.test'),'Dr. Samuel Lee',date('now','+39 days'),'15:00','Motility testing in practice','https://zoom.example.test/gastro-motility','Event Ready','test-gastro'),
  ('Gastro Test Colorectal Screening Review','Webinar',(SELECT id FROM speakers WHERE email='test.gastro.elena@example.test'),'Dr. Elena Park',date('now','-40 days'),'10:30','Improving colorectal screening','https://zoom.example.test/gastro-screening','Follow-Up Complete','test-gastro'),
  ('Gastro Test Nutrition Conference Debrief','Conference Debrief',(SELECT id FROM speakers WHERE email='test.gastro.marcus@example.test'),'Dr. Marcus Green',date('now','-8 days'),'13:30','Nutrition research highlights','https://zoom.example.test/gastro-nutrition','Completed','test-gastro');

WITH labels(position,label) AS (VALUES
  (1,'Speaker Confirmed'),(2,'Zoom Created'),(3,'Calendar Invite Sent'),
  (4,'Bio Collected'),(5,'Headshot Collected'),(6,'Faculty Profile Added'),
  (7,'Topic Finalized'),(8,'Slides Requested'),(9,'Slides Received'),
  (10,'Consent Form Received'),(11,'Marketing Team Notified'),(12,'Thank-You Email Sent')
)
INSERT OR IGNORE INTO event_checklist_items (event_id,label,position,due_date)
SELECT events.id,labels.label,labels.position,
  CASE
    WHEN events.event_date >= date('now')
      THEN date(events.event_date, printf('-%d days', 13-labels.position))
    ELSE events.event_date
  END
FROM events CROSS JOIN labels
WHERE events.hub_key IN ('test-heme','test-endo','test-gastro');

-- Make the seeded progress deterministic when this reset is run repeatedly.
UPDATE event_checklist_items
SET completed=0,completed_at=NULL,updated_at=CURRENT_TIMESTAMP
WHERE event_id IN (
  SELECT id FROM events WHERE hub_key IN ('test-heme','test-endo','test-gastro')
);

UPDATE event_checklist_items
SET completed=1,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
WHERE event_id IN (
  SELECT id FROM events
  WHERE hub_key LIKE 'test-%'
    AND status IN ('Speaker Confirmed','Zoom Scheduled','Materials Pending','Event Ready','Completed','Follow-Up Complete')
)
  AND position <= 1;

UPDATE event_checklist_items
SET completed=1,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
WHERE event_id IN (
  SELECT id FROM events
  WHERE hub_key LIKE 'test-%'
    AND status IN ('Zoom Scheduled','Materials Pending','Event Ready','Completed','Follow-Up Complete')
)
  AND position <= 3;

UPDATE event_checklist_items
SET completed=1,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
WHERE event_id IN (
  SELECT id FROM events
  WHERE hub_key LIKE 'test-%'
    AND status IN ('Materials Pending','Event Ready','Completed','Follow-Up Complete')
)
  AND position <= 8;

UPDATE event_checklist_items
SET completed=1,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
WHERE event_id IN (
  SELECT id FROM events
  WHERE hub_key LIKE 'test-%'
    AND status IN ('Event Ready','Completed','Follow-Up Complete')
)
  AND position <= 11;

UPDATE event_checklist_items
SET completed=1,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
WHERE event_id IN (
  SELECT id FROM events
  WHERE hub_key LIKE 'test-%' AND status='Follow-Up Complete'
);

INSERT OR IGNORE INTO email_material_reviews
  (message_key,sender_email,recipient_email,subject,attachment_name,material_type,checklist_label,speaker_id,event_id,hub_key)
VALUES
  ('test-heme-aisha-bio-v1','test.heme.aisha@example.test','faculty@example.test','Biography for the AML exchange','aisha-rahman-biography.docx','biography','Bio Collected',(SELECT id FROM speakers WHERE email='test.heme.aisha@example.test'),(SELECT id FROM events WHERE event_name='Heme Test AML Case Exchange'),'test-heme'),
  ('test-heme-maya-consent-v1','test.heme.maya@example.test','faculty@example.test','Signed faculty consent','maya-chen-consent.pdf','consent_form','Consent Form Received',(SELECT id FROM speakers WHERE email='test.heme.maya@example.test'),(SELECT id FROM events WHERE event_name='HemeHub Test Webinar'),'test-heme'),
  ('test-endo-hannah-bio-v1','test.endo.hannah@example.test','faculty@example.test','Thyroid session speaker bio','hannah-kim-bio.docx','biography','Bio Collected',(SELECT id FROM speakers WHERE email='test.endo.hannah@example.test'),(SELECT id FROM events WHERE event_name='Endo Test Thyroid Nodule Case Lab'),'test-endo'),
  ('test-endo-luis-consent-v1','test.endo.luis@example.test','faculty@example.test','Signed consent form','luis-rivera-consent.pdf','consent_form','Consent Form Received',(SELECT id FROM speakers WHERE email='test.endo.luis@example.test'),(SELECT id FROM events WHERE event_name='Endo Test Faculty Workshop'),'test-endo'),
  ('test-gastro-nia-slides-v1','test.gastro.nia@example.test','faculty@example.test','Advanced endoscopy slides','nia-campbell-endoscopy-slides.pptx','slides','Slides Received',(SELECT id FROM speakers WHERE email='test.gastro.nia@example.test'),(SELECT id FROM events WHERE event_name='Gastro Test Advanced Endoscopy Workshop'),'test-gastro'),
  ('test-gastro-isabel-consent-v1','test.gastro.isabel@example.test','faculty@example.test','IBD case exchange consent','isabel-torres-consent.pdf','consent_form','Consent Form Received',(SELECT id FROM speakers WHERE email='test.gastro.isabel@example.test'),(SELECT id FROM events WHERE event_name='Gastro Test IBD Case Exchange'),'test-gastro');
