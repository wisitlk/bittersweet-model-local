import { isRecord } from "./guards";
import { ageGroupOf, isMinor, type Member } from "./member";

/*
 * The fish-keeper survey in the LINE web app (PDPA consent -> survey -> age range + keeper type -> segments for
 * marketing and a better chat). Answers are fixed codes, so they can be analysed later.
 * Only for signed-up members (src/member.ts), whose age gives the age group; so PDPA consent and, under 20,
 * a parent's or guardian's consent were already given at sign-up.
 */

export const AGE_GROUPS = ["14-22", "23-30", "31-40", "41+"] as const;
export type AgeGroup = (typeof AGE_GROUPS)[number];

export const QUESTIONS = [
  {
    id: "q1_place",
    text: "จะวางปลาไว้ที่ไหน",
    options: [
      ["desk", "โต๊ะทำงาน/โต๊ะเรียน"],
      ["bedroom", "ห้องนอน"],
      ["living_room", "ห้องนั่งเล่น"],
      ["shop_office", "ร้าน/ออฟฟิศ"],
    ],
  },
  {
    id: "q2_tank",
    text: "ตอนนี้มีตู้หรือโหลแล้วหรือยัง",
    options: [
      ["none_yet", "ยังไม่มี"],
      ["small_jar", "โหลเล็ก ไม่ถึง 5 ลิตร"],
      ["tank_5_10", "ตู้ 5–10 ลิตร"],
      ["tank_big", "ตู้ใหญ่กว่า 10 ลิตร"],
    ],
  },
  {
    id: "q3_fin_style",
    text: "ชอบหางแบบไหน",
    options: [
      ["long_fin", "หางยาว พลิ้ว"],
      ["short_fin", "หางสั้น ว่ายไว"],
      ["any_fin", "ได้หมด"],
    ],
  },
  {
    id: "q4_keeper_type",
    text: "ข้อไหนเหมือนคุณที่สุด",
    options: [
      ["first_timer", "เพิ่งเริ่ม อยากได้ปลาเลี้ยงง่าย"],
      ["show_lover", "ชอบปลาหางสวยแบบปลาประกวด"],
      ["bold_collector", "ชอบปลาสีเข้ม ดุดัน"],
      ["desk_keeper", "อยากได้ปลาตัวเล็กสีสวยไว้บนโต๊ะ"],
      ["color_hunter", "ชอบสีแปลก ลายไม่ซ้ำใคร"],
    ],
  },
  {
    id: "q5_experience",
    text: "เคยเลี้ยงปลากัดมาก่อนไหม",
    options: [
      ["first_time", "ยังไม่เคย"],
      ["some", "เคยบ้าง"],
      ["experienced", "เลี้ยงประจำ"],
    ],
  },
  {
    id: "q6_buy_intent",
    text: "ถ้าจะซื้อ อยากได้แบบไหน",
    options: [
      ["fish_only", "ปลาอย่างเดียว"],
      ["with_kit", "ปลา + ชุดเริ่มต้นเลี้ยง"],
      ["just_browsing", "ดูไปก่อน"],
    ],
  },
] as const;

export type QuestionId = (typeof QUESTIONS)[number]["id"];
export type Answers = Record<QuestionId, string>;

/** Keeper type from q4, with the bot's CRM segment and the fish that suits that type. */
export const PERSONALITY = {
  first_timer: { type: "First Timer", label: "มือใหม่ อยากเลี้ยงง่าย", segment: "first_timer", fish: "blue_rim" },
  show_lover: { type: "Show Lover", label: "สายปลาโชว์หางสวย", segment: "show_lover", fish: "red_dragon" },
  bold_collector: { type: "Bold Collector", label: "สายสะสม ชอบปลาเข้มดุ", segment: "bold_collector", fish: "black_samurai" },
  desk_keeper: { type: "Desk Keeper", label: "สายแต่งโต๊ะ ปลาตัวเล็กสีสวย", segment: "desk_keeper", fish: "galaxy_koi" },
  color_hunter: { type: "Color Hunter", label: "สายล่าสีแปลก", segment: "color_hunter", fish: "nemo_candy" },
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
    personality: answers.q4_keeper_type as PersonalityKey,
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
export function surveyNote(s: Survey, fishName: string): string {
  const p = PERSONALITY[s.personality];
  return [
    "[ข้อมูลจากแบบสอบถามของลูกค้าคนนี้ ระบบใส่ให้ ไม่ใช่ข้อความที่ลูกค้าพิมพ์]",
    `ช่วงอายุ ${s.age_group}${s.under_20 ? " (อายุต่ำกว่า 20 ปี: ห้ามเร่งให้ซื้อ)" : ""}`,
    `สายเลี้ยง ${p.type} (segment ${p.segment}) ปลาที่เข้ากัน ${fishName}`,
    `วางที่: ${label("q1_place", s.answers.q1_place)} · ตู้: ${label("q2_tank", s.answers.q2_tank)}`,
    `หาง: ${label("q3_fin_style", s.answers.q3_fin_style)} · ประสบการณ์: ${label("q5_experience", s.answers.q5_experience)}`,
    "ใช้ข้อมูลนี้ช่วยแนะนำ แต่ถ้าลูกค้าบอกอย่างอื่นในแชท ให้เชื่อสิ่งที่ลูกค้าบอก",
  ].join("\n");
}
