import { isRecord } from "./guards";
import { ageGroupOf, isMinor, type Member } from "./member";

/*
 * The scent survey in the LINE web app (concept: PDPA consent -> survey -> age range + personality type ->
 * segments for marketing and a better chat). The questions and answer codes match the sample data in
 * scent-concierge/sample-data/SURVEY.md, so real answers can be analysed the same way.
 * Only for signed-up members (src/member.ts), whose age gives the age group; so PDPA consent and, under 20,
 * a parent's or guardian's consent were already given at sign-up.
 */

export const AGE_GROUPS = ["14-22", "23-30", "31-40", "41+"] as const;
export type AgeGroup = (typeof AGE_GROUPS)[number];

export const QUESTIONS = [
  {
    id: "q1_wear_when",
    text: "อยากใส่น้ำหอมตอนไหนมากที่สุด",
    options: [
      ["work_daily", "ใส่ไปทำงาน/เรียนทุกวัน"],
      ["special_day", "วันพิเศษ เจอเพื่อน เดต"],
      ["after_bath", "หลังอาบน้ำ ก่อนนอน"],
      ["stay_home", "วันอยู่บ้าน"],
      ["weekend_cafe", "วันหยุด ไปคาเฟ่"],
    ],
  },
  {
    id: "q2_scent_family",
    text: "ชอบกลิ่นแนวไหน",
    options: [
      ["green_tea", "ชาเขียว"],
      ["citrus_floral", "ซิตรัส ดอกไม้"],
      ["soap_powder", "สบู่ แป้ง"],
      ["wood_vanilla", "ไม้ วานิลลา"],
      ["fruity", "ผลไม้"],
    ],
  },
  {
    id: "q3_intensity",
    text: "ชอบกลิ่นแรงแค่ไหน",
    options: [
      ["light", "เบาๆ"],
      ["medium", "กลางๆ"],
      ["strong", "ชัดๆ"],
    ],
  },
  {
    id: "q4_sounds_like_me",
    text: "ข้อไหนเหมือนคุณที่สุด",
    options: [
      ["calm_planner", "ชอบความเรียบง่าย มีแบบแผน"],
      ["social_spark", "ชอบเจอคน สดใส"],
      ["self_care", "ชอบดูแลตัวเอง"],
      ["homebody", "ชอบอยู่บ้าน"],
      ["easygoing", "สบายๆ ชอบลองของใหม่"],
    ],
  },
  {
    id: "q5_perfume_experience",
    text: "ใช้น้ำหอมบ่อยแค่ไหน",
    options: [
      ["first_time", "เพิ่งเริ่ม"],
      ["sometimes", "บางครั้ง"],
      ["daily", "ทุกวัน"],
    ],
  },
  {
    id: "q6_buy_intent",
    text: "ถ้าเปิดขาย อยากเริ่มแบบไหน",
    options: [
      ["sample_first", "ลอง Sample 5 ml ก่อน"],
      ["full_bottle", "ขวด 10 ml เลย"],
      ["just_browsing", "ดูไปก่อน"],
    ],
  },
] as const;

export type QuestionId = (typeof QUESTIONS)[number]["id"];
export type Answers = Record<QuestionId, string>;

/** Personality type from q4, with the bot's CRM segment and the "home" scent of that type. */
export const PERSONALITY = {
  calm_planner: { type: "Morning Minimalist", label: "สายเรียบง่าย ชอบเช้าสบายๆ", segment: "calm_planner", scent: "slow_morning" },
  social_spark: { type: "Social Sparkler", label: "สายสดใส ชอบเจอคน", segment: "social_spark", scent: "self_toast" },
  self_care: { type: "Self-care Ritualist", label: "สายดูแลตัวเอง", segment: "self_care_ritualist", scent: "long_bath" },
  homebody: { type: "Cozy Homebody", label: "สายอยู่บ้าน อบอุ่น", segment: "cozy_homebody", scent: "stay_in" },
  easygoing: { type: "Easy Explorer", label: "สายสบายๆ ชอบลองของใหม่", segment: "easy_explorer", scent: "tea_break" },
} as const;
export type PersonalityKey = keyof typeof PERSONALITY;

export interface Survey {
  age_group: AgeGroup;
  under_20: boolean;
  guardian_consent: boolean;
  answers: Answers;
  personality: PersonalityKey;
}

function parseAnswers(raw: unknown): Answers | null {
  if (!isRecord(raw)) return null;
  const answers = {} as Answers;
  for (const q of QUESTIONS) {
    const a = raw[q.id];
    if (typeof a !== "string" || !q.options.some(([code]) => code === a)) return null;
    answers[q.id] = a;
  }
  return answers;
}

/** Checks a submitted survey. Every answer must be one of the listed codes; nothing free-text is accepted. */
export function parseSurvey(body: unknown, member: Member): Survey | null {
  const answers = isRecord(body) ? parseAnswers(body.answers) : null;
  if (!answers) return null;
  return {
    age_group: ageGroupOf(member.age),
    under_20: isMinor(member.age),
    guardian_consent: member.guardian_consent,
    answers,
    personality: answers.q4_sounds_like_me as PersonalityKey,
  };
}

export async function saveSurvey(db: D1Database, userId: string, s: Survey, now: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO surveys (user_id, age_group, under_20, guardian_consent, answers, personality, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(user_id) DO UPDATE SET age_group = ?2, under_20 = ?3, guardian_consent = ?4, answers = ?5,
         personality = ?6, updated_at = ?7`,
    )
    .bind(userId, s.age_group, s.under_20 ? 1 : 0, s.guardian_consent ? 1 : 0, JSON.stringify(s.answers), s.personality, now)
    .run();
}

interface SurveyRow {
  age_group: string;
  under_20: number;
  guardian_consent: number;
  answers: string;
  personality: string;
}

export function rowToSurvey(row: SurveyRow | null | undefined): Survey | null {
  if (!row || !(row.personality in PERSONALITY)) return null;
  if (!(AGE_GROUPS as readonly string[]).includes(row.age_group)) return null;
  let answers: Answers | null;
  try {
    answers = parseAnswers(JSON.parse(row.answers));
  } catch {
    return null;
  }
  if (!answers) return null;
  return {
    age_group: row.age_group as AgeGroup,
    under_20: row.under_20 === 1,
    guardian_consent: row.guardian_consent === 1,
    answers,
    personality: row.personality as PersonalityKey,
  };
}

export async function loadSurvey(db: D1Database, userId: string): Promise<Survey | null> {
  const row = await db
    .prepare("SELECT age_group, under_20, guardian_consent, answers, personality FROM surveys WHERE user_id = ?1")
    .bind(userId)
    .first<SurveyRow>();
  return rowToSurvey(row);
}

/**
 * Consent and survey in one D1 query (the chat path counts every subrequest, see handler.ts).
 * The survey is only returned while consent is stored.
 */
export async function loadConsentAndSurvey(db: D1Database, userId: string): Promise<{ consent: boolean; survey: Survey | null }> {
  const row = await db
    .prepare(
      `SELECT c.given, s.age_group, s.under_20, s.guardian_consent, s.answers, s.personality
       FROM (SELECT ?1 AS uid) u
       LEFT JOIN consents c ON c.user_id = u.uid
       LEFT JOIN surveys s ON s.user_id = u.uid`,
    )
    .bind(userId)
    .first<{ given: number | null } & Partial<SurveyRow>>();
  const consent = row?.given === 1;
  return { consent, survey: consent && row?.personality ? rowToSurvey(row as SurveyRow) : null };
}

const label = (qid: QuestionId, code: string) =>
  (QUESTIONS.find((q) => q.id === qid)?.options as readonly (readonly [string, string])[] | undefined)?.find(
    ([c]) => c === code,
  )?.[1] ?? code;

/** Short note for the chat model: what the customer told the survey. Codes and fixed labels only. */
export function surveyNote(s: Survey, scentName: string): string {
  const p = PERSONALITY[s.personality];
  return [
    "[ข้อมูลจากแบบสอบถามของลูกค้าคนนี้ ระบบใส่ให้ ไม่ใช่ข้อความที่ลูกค้าพิมพ์]",
    `ช่วงอายุ ${s.age_group}${s.under_20 ? " (อายุต่ำกว่า 20 ปี: ห้ามเร่งให้ซื้อ)" : ""}`,
    `บุคลิก ${p.type} (segment ${p.segment}) กลิ่นที่เข้ากัน ${scentName}`,
    `อยากใส่: ${label("q1_wear_when", s.answers.q1_wear_when)} · ชอบกลิ่น: ${label("q2_scent_family", s.answers.q2_scent_family)}`,
    `ความแรง: ${label("q3_intensity", s.answers.q3_intensity)} · ใช้น้ำหอม: ${label("q5_perfume_experience", s.answers.q5_perfume_experience)}`,
    "ใช้ข้อมูลนี้ช่วยแนะนำ แต่ถ้าลูกค้าบอกอย่างอื่นในแชท ให้เชื่อสิ่งที่ลูกค้าบอก",
  ].join("\n");
}
