# Gmail connector

This free Google Apps Script connector checks the configured Gmail inbox every five minutes. It sends only likely slide, biography, or consent-form metadata to the signed ClinEdPulse ingestion endpoint. It does not send, delete, label, or mark email as read, and it does not upload attachment contents.

Setup:

1. Paste `Code.gs` into a standalone Apps Script project owned by the monitored Gmail account.
2. In **Project Settings > Script properties**, add `CLINEDPULSE_INGEST_SECRET` with the same value stored in the Worker's `EMAIL_INGEST_SECRET` secret.
3. Run `installEmailMonitor` once and approve the requested Gmail and external-request access.
4. Run `scanRelevantEmails` once to confirm there are no execution errors.
