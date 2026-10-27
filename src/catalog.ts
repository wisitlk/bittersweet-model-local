/*
 * What the web app shows. Names, sizes and prices come from content/knowledge.md (the source of truth); keep them in
 * step when that file changes. Descriptions only restate what knowledge.md says: no notes, stock or dates.
 */
export interface Product {
  id: string;
  name: string;
  size: string;
  price: number; // THB
  blurb: string; // Thai, customer-facing
  color: string; // card background, shown behind (or instead of) the photo
  image?: string; // a file in public/, e.g. "/img/fresh_leaf.jpg"; without one the card shows `color`
}

export const PRODUCTS: readonly Product[] = [
  {
    id: "fresh_leaf",
    image: "/img/fresh_leaf.jpg",
    name: "Fresh Leaf",
    size: "10 ml",
    price: 450,
    blurb: "สดและเขียวที่สุด กลิ่นใบชาสด ใส่ได้ทุกวัน",
    color: "#9cc58a",
  },
  {
    id: "cilantro",
    image: "/img/cilantro.jpg",
    name: "Cilantro",
    size: "10 ml",
    price: 450,
    blurb: "เขียวชัดแบบสมุนไพรใบผักชี คนรักก็รักมาก คนไม่ชอบก็ไม่ชอบเลย",
    color: "#5f8f4e",
  },
  {
    id: "last_sip",
    image: "/img/last_sip.jpg",
    name: "Last Sip",
    size: "10 ml",
    price: 450,
    blurb: "จบอุ่นๆ เหมือนจิบชาคำสุดท้าย นุ่มที่สุดในสามกลิ่น",
    color: "#b98a5a",
  },
  {
    id: "discovery_set",
    image: "/img/scents.jpg",
    name: "Discovery set",
    size: "3 × 2 ml",
    price: 350,
    blurb: "ลองครบ 3 กลิ่น นำ 350 บาทไปเป็นส่วนลดขวดเต็มได้",
    color: "#d9c7a7",
  },
];

/** Points awarded once per user for each reason. Shown on the points page. */
export const POINT_RULES = {
  friend: { points: 10, label: "เพิ่ม BitterSweet เป็นเพื่อนใน LINE" },
  consent: { points: 20, label: "ยินยอมให้เก็บโปรไฟล์กลิ่น (PDPA)" },
  waitlist: { points: 30, label: "ลงชื่อ pre-order" },
} as const;

export type PointReason = keyof typeof POINT_RULES;

export function findProduct(id: unknown): Product | undefined {
  return PRODUCTS.find((p) => p.id === id);
}
