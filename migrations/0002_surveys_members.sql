-- Adds the survey and member tables to an existing database (safe to run twice):
--   npx wrangler d1 execute bitter_sweet --remote --file migrations/0002_surveys_members.sql

-- Scent survey from the web app (src/survey.ts), members only (consent given at sign-up).
-- Kept past the 7-day cleanup (it is what the segments are built from); deleted when the user asks to delete their data.
CREATE TABLE IF NOT EXISTS surveys (
  user_id           TEXT PRIMARY KEY,
  age_group         TEXT NOT NULL,      -- 14-22 | 23-30 | 31-40 | 41+ (from the member's age)
  under_20          INTEGER NOT NULL,
  guardian_consent  INTEGER NOT NULL,
  answers           TEXT NOT NULL,      -- JSON of answer codes (q1..q6), never free text
  personality       TEXT NOT NULL,      -- q4 code, see PERSONALITY in src/survey.ts
  updated_at        INTEGER NOT NULL
);

-- Members who signed up in the web app (src/member.ts): personal data, so only with PDPA consent (and a
-- guardian's under 20). Never logged or sent to the Sheet; deleted when the user asks to delete their data.
CREATE TABLE IF NOT EXISTS members (
  user_id           TEXT PRIMARY KEY,
  first_name        TEXT NOT NULL,
  last_name         TEXT NOT NULL,
  phone             TEXT NOT NULL,
  age               INTEGER NOT NULL,
  guardian_consent  INTEGER NOT NULL,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
