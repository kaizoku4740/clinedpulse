-- Test-mode records live in dedicated hub namespaces. Normal hub queries never
-- include these rows, and email/Calendly ingestion continues to use live hubs.
INSERT OR IGNORE INTO speakers
  (name,email,institution,specialty,faculty_profile_url,notes,participation_history,hub_key)
VALUES
  ('Dr. Maya Chen','test.heme.maya@example.test','Northstar Medical Center','Hematology','','Fictional test-mode speaker.','2025 ClinEdPulse Test Summit','test-heme'),
  ('Dr. Noah Williams','test.heme.noah@example.test','Lakeside University Hospital','Medical Oncology','','Fictional test-mode speaker.','','test-heme'),
  ('Dr. Luis Rivera','test.endo.luis@example.test','Harbor Endocrine Institute','Endocrinology','','Fictional test-mode speaker.','2025 Diabetes Education Test Series','test-endo'),
  ('Dr. Priya Shah','test.endo.priya@example.test','Midtown Academic Health','Diabetes Care','','Fictional test-mode speaker.','','test-endo'),
  ('Dr. Elena Park','test.gastro.elena@example.test','Westview Digestive Health','Gastroenterology','','Fictional test-mode speaker.','2025 GI Test Forum','test-gastro'),
  ('Dr. Marcus Green','test.gastro.marcus@example.test','Central University Medical Center','Hepatology','','Fictional test-mode speaker.','','test-gastro');

INSERT OR IGNORE INTO events
  (event_name,event_type,speaker_id,speaker_name,event_date,event_time,topic,zoom_link,status,hub_key)
VALUES
  ('HemeHub Test Webinar','Webinar',(SELECT id FROM speakers WHERE email='test.heme.maya@example.test'),'Dr. Maya Chen',date('now','+14 days'),'14:00','Emerging approaches in hematology','','Materials Pending','test-heme'),
  ('HemeHub Completed Test Session','Case Discussion',(SELECT id FROM speakers WHERE email='test.heme.noah@example.test'),'Dr. Noah Williams',date('now','-30 days'),'11:00','Fictional case review','','Completed','test-heme'),
  ('Endo Test Faculty Workshop','Faculty Workshop',(SELECT id FROM speakers WHERE email='test.endo.luis@example.test'),'Dr. Luis Rivera',date('now','+18 days'),'13:30','Practical diabetes education','','Materials Pending','test-endo'),
  ('Endo Completed Test Webinar','Webinar',(SELECT id FROM speakers WHERE email='test.endo.priya@example.test'),'Dr. Priya Shah',date('now','-21 days'),'10:00','Fictional endocrine update','','Completed','test-endo'),
  ('Gastro Test Summit Session','Summit Session',(SELECT id FROM speakers WHERE email='test.gastro.elena@example.test'),'Dr. Elena Park',date('now','+10 days'),'15:00','Digestive health education','','Materials Pending','test-gastro'),
  ('Gastro Completed Test Discussion','Case Discussion',(SELECT id FROM speakers WHERE email='test.gastro.marcus@example.test'),'Dr. Marcus Green',date('now','-16 days'),'12:00','Fictional liver case review','','Completed','test-gastro');

WITH labels(position,label) AS (VALUES
  (1,'Speaker Confirmed'),(2,'Zoom Created'),(3,'Calendar Invite Sent'),
  (4,'Bio Collected'),(5,'Headshot Collected'),(6,'Faculty Profile Added'),
  (7,'Topic Finalized'),(8,'Slides Requested'),(9,'Slides Received'),
  (10,'Consent Form Received'),(11,'Marketing Team Notified'),(12,'Thank-You Email Sent')
)
INSERT OR IGNORE INTO event_checklist_items (event_id,label,position,due_date)
SELECT events.id,labels.label,labels.position,
  CASE WHEN events.event_date >= date('now') THEN date(events.event_date, printf('-%d days', 13-labels.position)) ELSE events.event_date END
FROM events CROSS JOIN labels
WHERE events.hub_key IN ('test-heme','test-endo','test-gastro');

UPDATE event_checklist_items
SET completed=1,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
WHERE event_id IN (SELECT id FROM events WHERE hub_key LIKE 'test-%')
  AND label IN ('Speaker Confirmed','Zoom Created','Calendar Invite Sent','Bio Collected','Headshot Collected','Faculty Profile Added','Topic Finalized','Slides Requested','Marketing Team Notified');

UPDATE event_checklist_items
SET completed=1,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
WHERE event_id IN (SELECT id FROM events WHERE hub_key LIKE 'test-%' AND status='Completed')
  AND label IN ('Slides Received','Consent Form Received');

INSERT OR IGNORE INTO email_material_reviews
  (message_key,sender_email,recipient_email,subject,attachment_name,material_type,checklist_label,speaker_id,event_id,hub_key)
VALUES
  ('test-mode-heme-slides-v1','test.heme.maya@example.test','faculty@example.test','Updated presentation attached','maya-chen-presentation.pptx','slides','Slides Received',(SELECT id FROM speakers WHERE email='test.heme.maya@example.test'),(SELECT id FROM events WHERE event_name='HemeHub Test Webinar' AND hub_key='test-heme'),'test-heme'),
  ('test-mode-endo-bio-v1','test.endo.luis@example.test','faculty@example.test','Speaker biography','luis-rivera-biography.docx','biography','Bio Collected',(SELECT id FROM speakers WHERE email='test.endo.luis@example.test'),(SELECT id FROM events WHERE event_name='Endo Test Faculty Workshop' AND hub_key='test-endo'),'test-endo'),
  ('test-mode-gastro-consent-v1','test.gastro.elena@example.test','faculty@example.test','Signed consent form','elena-park-consent.pdf','consent_form','Consent Form Received',(SELECT id FROM speakers WHERE email='test.gastro.elena@example.test'),(SELECT id FROM events WHERE event_name='Gastro Test Summit Session' AND hub_key='test-gastro'),'test-gastro');
