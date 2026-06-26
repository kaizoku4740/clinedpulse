import { db } from '../lib/database.js';

const count = db.prepare('SELECT COUNT(*) count FROM speakers').get().count;
if (count) {
  console.log('Seed skipped: the database already contains speakers.');
  process.exit(0);
}

const placeholders = [
  ['Dr. John Doe', 'john.doe@example.com', 'Example Hospital', 'Hematology', 'Participated in a previous test event.', 'Prefers email communication.'],
  ['Dr. Jane Smith', 'jane.smith@example.com', 'Sample Medical Center', 'Medical Oncology', 'No previous participation recorded.', 'Interested in hematologic malignancies.'],
  ['Dr. Alex Johnson', 'alex.johnson@example.com', 'Demo University', 'Cellular Therapy', 'Participated in a sample summit.', 'Placeholder record — do not use for outreach.']
];

const insert = db.prepare(`INSERT INTO speakers
  (name,email,institution,specialty,participation_history,notes)
  VALUES (?,?,?,?,?,?)`);
placeholders.forEach(row => insert.run(...row));
console.log('Three fictional placeholder speakers added.');
