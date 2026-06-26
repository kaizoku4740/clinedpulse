# ClinEdPulse Speaker Database — Phase 1

Phase 1 is intentionally limited to the speaker directory from the CEOS project plan.

## Goal and data source

The goal is to replace scattered notes and spreadsheets with one searchable source of speaker information. During Phase 1, the Operations Coordinator enters records manually using information from physician emails, public faculty profile pages, and ClinEdPulse's existing participation records. No information is automatically imported yet.

## Included

- Add and edit speaker profiles
- Store name, email, institution, specialty, faculty profile URL, previous participation history, and internal notes
- Search by name, email, specialty, or institution
- Overview counts for speakers, specialties, and institutions
- Fictional placeholder data for safe testing

Events, checklists, scheduling, Calendly, email monitoring, and automations are deferred to later phases.

## Run locally

Node.js 22.5 or newer is required. The project has no third-party dependencies.

```bash
npm run seed
npm start
```

Open `http://localhost:3000`.

Run tests with:

```bash
npm test
```

The seed records use `example.com` addresses and fictional institutions. Do not use them for real outreach.

## Deploy to Cloudflare

The local app uses Node.js and a local SQLite file. The Cloudflare version uses the same front end, plus a Worker API and Cloudflare D1 database for production storage.

One-time setup:

```bash
wrangler login
wrangler d1 create clinedpulse-speaker-database
```

Copy the `database_id` from that command into `wrangler.jsonc`, replacing `REPLACE_WITH_D1_DATABASE_ID`.

Then run:

```bash
npm run cf:migrate:remote
npm run cf:deploy
```
