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
    id: "slow_morning",
    image: "/img/slow_morning.jpg",
    name: "Slow Morning",
    size: "10 ml · Sample 5 ml 249 บาท",
    price: 450,
    blurb: "No. 01 · ชาเขียว นุ่ม สะอาด เหมาะกับใส่ไปทำงานทุกวัน",
    color: "#a9b98f",
  },
  {
    id: "self_toast",
    image: "/img/self_toast.jpg",
    name: "Self Toast",
    size: "10 ml · Sample 5 ml 249 บาท",
    price: 450,
    blurb: "No. 02 · ซิตรัส ดอกไม้ขาว มีประกาย เหมาะกับวันพิเศษ นัดเพื่อน ไปเดต",
    color: "#e0c48a",
  },
  {
    id: "long_bath",
    image: "/img/long_bath.jpg",
    name: "Long Bath",
    size: "10 ml · Sample 5 ml 249 บาท",
    price: 450,
    blurb: "No. 03 · ฟองสบู่ แป้ง มัสก์ กลิ่นตัวสะอาดแบบเพิ่งอาบน้ำ",
    color: "#d9cfd6",
  },
  {
    id: "stay_in",
    image: "/img/stay_in.jpg",
    name: "Stay In",
    size: "10 ml · Sample 5 ml 249 บาท",
    price: 450,
    blurb: "No. 04 · แป้ง ไม้ มัสก์ อุ่นๆ เหมาะกับวันอยู่บ้านหรือหน้าฝน",
    color: "#b59a82",
  },
  {
    id: "tea_break",
    image: "/img/tea_break.jpg",
    name: "Tea Break",
    size: "10 ml · Sample 5 ml 249 บาท",
    price: 450,
    blurb: "No. 05 · แพร์ ชาเขียว ลิลลี่ เบาสบาย เหมาะกับคนเพิ่งเริ่มใช้น้ำหอม",
    color: "#c9cf9a",
  },
];

/** Buying a Sample 5 ml (249 THB) and then a 10 ml bottle within 30 days credits the 249 THB back. */
export const SAMPLE_PRICE = 249;

/** Points awarded once per user for each reason. Shown on the points page. */
export const POINT_RULES = {
  register: { points: 50, label: "สมัครสมาชิก" },
  friend: { points: 10, label: "เพิ่ม BitterSweet เป็นเพื่อนใน LINE" },
  consent: { points: 20, label: "ยินยอมให้เก็บโปรไฟล์กลิ่น (PDPA)" },
  waitlist: { points: 30, label: "ลงชื่อ pre-order" },
  survey: { points: 30, label: "ทำแบบสอบถามกลิ่น" },
} as const;

export type PointReason = keyof typeof POINT_RULES;

export function findProduct(id: unknown): Product | undefined {
  return PRODUCTS.find((p) => p.id === id);
}
