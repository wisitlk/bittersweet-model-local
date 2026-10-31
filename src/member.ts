import { isRecord } from "./guards";
import type { AgeGroup } from "./survey";

/*
 * Member sign-up in the LINE web app: after LINE Login the customer gives first name, last name, phone and age.
 * This is personal data, so it is stored only with PDPA consent (and a parent's or guardian's under 20), kept
 * in D1 only (never logged, never sent to the Sheet), and deleted when the customer asks to delete their data.
 */

export const MIN_AGE = 14; // youngest age group in the concept (14-22)
export const MAX_AGE = 99;
const MAX_NAME_CHARS = 60;

export interface Member {
  first_name: string;
  last_name: string;
  phone: string; // Thai number, digits only, e.g. 0812345678
  age: number;
  guardian_consent: boolean;
}

export type MemberError = "bad_request" | "bad_name" | "bad_phone" | "bad_age" | "guardian_required";

/** Age groups used by the survey analysis; over 40 gets its own group so it is not mixed into 31-40. */
export function ageGroupOf(age: number): AgeGroup {
  if (age <= 22) return "14-22";
  if (age <= 30) return "23-30";
  if (age <= 40) return "31-40";
  return "41+";
}

export const isMinor = (age: number) => age < 20;

function cleanName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  // Letters (Thai or Latin), spaces, dot, hyphen and apostrophe only: no markup, no control characters.
  const s = v.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!s || s.length > MAX_NAME_CHARS || !/^[\p{L}\p{M} .'-]+$/u.test(s)) return null;
  return s;
}

/** Thai phone: 10 digits starting with 0 (mobile 06/08/09 or landline 02-07); +66 is turned into 0. */
export function cleanPhone(v: unknown): string | null {
  if (typeof v !== "string") return null;
  let d = v.replace(/[\s-]/g, "");
  if (d.startsWith("+66")) d = "0" + d.slice(3);
  return /^0[2-9]\d{8}$/.test(d) || /^0[2-7]\d{7}$/.test(d) ? d : null;
}

export function parseMember(body: unknown): Member | MemberError {
  if (!isRecord(body)) return "bad_request";
  const first = cleanName(body.first_name);
  const last = cleanName(body.last_name);
  if (!first || !last) return "bad_name";
  const phone = cleanPhone(body.phone);
  if (!phone) return "bad_phone";
  const age = typeof body.age === "string" ? Number(body.age) : body.age;
  if (typeof age !== "number" || !Number.isInteger(age) || age < MIN_AGE || age > MAX_AGE) return "bad_age";
  if (isMinor(age) && body.guardian_consent !== true) return "guardian_required";
  return { first_name: first, last_name: last, phone, age, guardian_consent: isMinor(age) };
}

export async function saveMember(db: D1Database, userId: string, m: Member, now: number): Promise<boolean> {
  const r = await db
    .prepare(
      `INSERT INTO members (user_id, first_name, last_name, phone, age, guardian_consent, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
       ON CONFLICT(user_id) DO UPDATE SET first_name = ?2, last_name = ?3, phone = ?4, age = ?5,
         guardian_consent = ?6, updated_at = ?7`,
    )
    .bind(userId, m.first_name, m.last_name, m.phone, m.age, m.guardian_consent ? 1 : 0, now)
    .run();
  return r.meta.changes === 1;
}

export async function loadMember(db: D1Database, userId: string): Promise<Member | null> {
  const row = await db
    .prepare("SELECT first_name, last_name, phone, age, guardian_consent FROM members WHERE user_id = ?1")
    .bind(userId)
    .first<{ first_name: string; last_name: string; phone: string; age: number; guardian_consent: number }>();
  if (!row) return null;
  return { ...row, guardian_consent: row.guardian_consent === 1 };
}
