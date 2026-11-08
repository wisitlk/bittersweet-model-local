/*
 * What the web app shows. Names, sizes and prices come from content/knowledge.md (the source of truth); keep them in
 * step when that file changes. Descriptions only restate what knowledge.md and the product sheet say: no stock or dates.
 */
export interface Product {
  id: string;
  name: string;
  size: string;
  price: number; // THB
  blurb: string; // Thai, customer-facing
  color: string; // card background, shown behind (or instead of) the photo
  image?: string; // a file in public/, e.g. "/img/fresh_leaf.jpg"; without one the card shows `color`
  detail: ScentDetail; // the scent's own page (liff.line.me/<LIFF_ID>?scent=<id>), from the product sheet PDF
}

/** The product sheet's page for one scent (ข้อมูลสินค้า BitterSweet V0.0.6, 2026-10-28). Thai, customer-facing. */
export interface ScentDetail {
  number: string; // "No. 01"; shown on the web page only, never in the chat
  tagline: string;
  smells: string; // กลิ่นที่ได้
  feel: string; // ฉีดแล้วรู้สึก
  suits: readonly string[]; // เหมาะกับใคร
  when: string; // ใช้ตอนไหน
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
    detail: {
      number: "No. 01",
      tagline: "เช้าที่ไม่ต้องรีบไปไหน",
      smells: "ชาเขียวมัทฉะนุ่มๆ เหมือนถ้วยชาอุ่นที่ถือไว้สองมือ ตามด้วยกลิ่นไม้อ่อนๆ ที่สะอาด ไม่ฉุน",
      feel: "สงบ ใจเย็น เหมือนได้เริ่มวันในจังหวะของตัวเอง",
      suits: [
        "คนที่ชอบกลิ่นสะอาด เรียบ ไม่ดังเกินคนข้างๆ",
        "คนชอบชาเขียวและบรรยากาศคาเฟ่ตอนเช้า",
        "คนทำงานออฟฟิศที่อยากได้กลิ่นใส่ทุกวันโดยไม่ต้องคิด",
      ],
      when: "ตอนเช้าก่อนออกจากบ้าน วันทำงาน วันที่อยากให้ตัวเองใจเย็นลง",
    },
  },
  {
    id: "self_toast",
    image: "/img/self_toast.jpg",
    name: "Self Toast",
    size: "10 ml · Sample 5 ml 249 บาท",
    price: 450,
    blurb: "No. 02 · ซิตรัส ดอกไม้ขาว มีประกาย เหมาะกับวันพิเศษ นัดเพื่อน ไปเดต",
    color: "#e0c48a",
    detail: {
      number: "No. 02",
      tagline: "ชนแก้วให้ตัวเอง ไม่ต้องมีเหตุผล",
      smells: "ซิตรัสสดซ่าเหมือนเปิดขวดแชมเปญ ตามด้วยดอกไม้ขาวกับกุหลาบ ปิดท้ายด้วยแอมเบอร์อุ่นๆ",
      feel: "สดใส มีชีวิตชีวา ภูมิใจในตัวเอง",
      suits: [
        "คนที่ชอบกลิ่นสดใสมีประกาย อยากให้คนรอบตัวได้กลิ่นบ้าง",
        "คนที่อยากฉลองให้ตัวเองในวันธรรมดา",
        "คนชอบดอกไม้แต่ไม่อยากได้กลิ่นดอกไม้ที่หนักเกินไป",
      ],
      when: "วันที่มีเรื่องดีใจ นัดเพื่อน ไปเดต งานเลี้ยงเล็กๆ ช่วงเย็นถึงกลางคืน",
    },
  },
  {
    id: "long_bath",
    image: "/img/long_bath.jpg",
    name: "Long Bath",
    size: "10 ml · Sample 5 ml 249 บาท",
    price: 450,
    blurb: "No. 03 · ฟองสบู่ แป้ง มัสก์ กลิ่นตัวสะอาดแบบเพิ่งอาบน้ำ",
    color: "#d9cfd6",
    detail: {
      number: "No. 03",
      tagline: "น้ำอุ่น ประตูปิด เวลาที่เป็นของเราคนเดียว",
      smells: "ฟองสบู่กับดอกไม้อ่อนๆ ตอนเปิด แล้วค่อยๆ เป็นแป้งนุ่มกับมัสก์ที่ติดผิว เหมือนเพิ่งอาบน้ำเสร็จ",
      feel: "ผ่อนคลาย นุ่มนวล อ่อนโยนกับตัวเอง",
      suits: [
        "คนที่ชอบกลิ่นตัวสะอาดแบบเพิ่งอาบน้ำ",
        "คนชอบกลิ่นแป้งกับมัสก์ที่อยู่ใกล้ตัว ไม่ฟุ้งไกล",
        "คนที่ใช้น้ำหอมเพื่อให้ตัวเองรู้สึกดี มากกว่าให้คนอื่นได้กลิ่น",
      ],
      when: "หลังอาบน้ำ ก่อนนอน วันพักผ่อนอยู่บ้าน หรือวันที่อยากให้ตัวเองหายเหนื่อย",
    },
  },
  {
    id: "stay_in",
    image: "/img/stay_in.jpg",
    name: "Stay In",
    size: "10 ml · Sample 5 ml 249 บาท",
    price: 450,
    blurb: "No. 04 · แป้ง ไม้ มัสก์ อุ่นๆ เหมาะกับวันอยู่บ้านหรือหน้าฝน",
    color: "#b59a82",
    detail: {
      number: "No. 04",
      tagline: "ยกเลิกนัด แล้วเลือกโซฟา",
      smells: "แป้งนุ่มกับดอกไม้จางๆ ตอนเปิด แล้วค่อยๆ อุ่นขึ้นเป็นไม้ มัสก์ และวานิลลาบางๆ เหมือนผ้าห่มผืนโปรด",
      feel: "อบอุ่น ปลอดภัย ได้อยู่กับตัวเอง",
      suits: [
        "คนที่ชอบกลิ่นอุ่นๆ กลิ่นไม้ ไม่ชอบกลิ่นสดเปรี้ยว",
        "คนรักบ้าน ชอบวันที่ได้อยู่กับหนังสือ ซีรีส์ และผ้าห่ม",
        "คนที่อยากได้กลิ่นติดเสื้อผ้า ดมแล้วสบายใจ",
      ],
      when: "วันอยู่บ้าน ห้องแอร์เย็นๆ หน้าฝน ช่วงค่ำถึงก่อนนอน",
    },
  },
  {
    id: "tea_break",
    image: "/img/tea_break.jpg",
    name: "Tea Break",
    size: "10 ml · Sample 5 ml 249 บาท",
    price: 450,
    blurb: "No. 05 · แพร์ ชาเขียว ลิลลี่ เบาสบาย เหมาะกับคนเพิ่งเริ่มใช้น้ำหอม",
    color: "#c9cf9a",
    detail: {
      number: "No. 05",
      tagline: "วันหยุดสบายๆ ที่ไม่มีอะไรต้องทำ",
      smells: "แพร์สดกรอบเปิดมาก่อน ตามด้วยชาเขียวและลิลลี่ ปิดท้ายด้วยมัสก์กับไม้ซีดาร์บางๆ",
      feel: "เบาสบาย ปลอดโปร่ง ได้พักจริงๆ",
      suits: [
        "คนที่ชอบกลิ่นผลไม้สดที่ไม่เลี่ยน",
        "คนที่เพิ่งเริ่มใช้น้ำหอม อยากได้กลิ่นที่ใส่ง่าย",
        "คนชอบเที่ยวคาเฟ่ ชอบวันหยุดแบบไม่มีแผน",
      ],
      when: "วันหยุด เที่ยวคาเฟ่ ช่วงบ่าย อากาศร้อนแล้วอยากได้กลิ่นที่เบาและสดชื่น",
    },
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
