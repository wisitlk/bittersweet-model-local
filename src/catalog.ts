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
  image?: string; // a file in public/, e.g. "/img/red_dragon.jpg"; without one the card shows `color`
  detail: ScentDetail; // the fish's own page (liff.line.me/<LIFF_ID>?scent=<id>)
}

/** One fish's own page. Field names are kept from the perfume shop's product sheet; Thai, customer-facing. */
export interface ScentDetail {
  number: string; // the shop's code, e.g. "BF-001"; shown on the web page only
  tagline: string;
  smells: string; // หน้าตาเป็นแบบไหน
  feel: string; // ดูแล้วให้ความรู้สึก
  suits: readonly string[]; // เหมาะกับใคร
  when: string; // การดูแล
}

export const PRODUCTS: readonly Product[] = [
  {
    id: "red_dragon",
    image: "/img/red_dragon.jpg",
    name: "Red Dragon Halfmoon",
    size: "ตัวผู้ · Halfmoon หางยาว",
    price: 450,
    blurb: "หางยาวกางเต็มครึ่งวงกลม ตัวแดงเงาเกล็ดมังกร เหมาะเป็นปลาโชว์บนโต๊ะ",
    color: "#c0392b",
    detail: {
      number: "BF-001",
      tagline: "ปลาโชว์หางพลิ้ว สายประกวด",
      smells: "หางยาวแบบ Halfmoon กางได้ 180 องศาเวลาพองตัว ลำตัวแดงเข้มมีเกล็ดเงาแบบเกล็ดมังกร",
      feel: "สง่า โดดเด่น เป็นจุดสนใจของมุมที่วาง",
      suits: [
        "คนที่ชอบปลาหางยาวสวยแบบปลาประกวด",
        "คนที่อยากได้ปลาตัวเดียวเป็นจุดเด่นบนโต๊ะหรือชั้นวาง",
        "คนที่ดูแลตู้ได้สม่ำเสมอ",
      ],
      when: "ใช้ตู้ 5 ลิตรขึ้นไป น้ำไหลเบาๆ ไม่ใส่ของตกแต่งคม เพราะหางยาวขาดง่าย",
    },
  },
  {
    id: "blue_rim",
    name: "Blue Rim Plakat",
    size: "ตัวผู้ · Plakat หางสั้น",
    price: 350,
    blurb: "หางสั้น ว่ายไว ขอบครีบสีฟ้า แข็งแรง เหมาะกับคนเพิ่งเริ่มเลี้ยง",
    color: "#2e6fa7",
    detail: {
      number: "BF-002",
      tagline: "ปลากัดตัวแรกที่เลี้ยงง่าย",
      smells: "ปลากัดหางสั้น (Plakat) ว่ายเร็ว ขอบครีบสีฟ้าตัดกับลำตัว",
      feel: "ปราดเปรียว มีนิสัย ชอบว่ายมาทักคนเลี้ยง",
      suits: ["คนที่เพิ่งเริ่มเลี้ยงปลากัดตัวแรก", "คนที่ชอบปลาว่ายไว แอคทีฟ", "คนที่ยังไม่มีตู้ (ซื้อพร้อมชุดเริ่มต้นได้)"],
      when: "ตู้ 5 ลิตรขึ้นไป เปลี่ยนน้ำทุกสัปดาห์",
    },
  },
  {
    id: "black_samurai",
    name: "Black Samurai",
    size: "ตัวผู้ · Plakat หางสั้น",
    price: 590,
    blurb: "ตัวดำสนิท เกล็ดขอบเงินเหมือนชุดเกราะซามูไร ดุดัน สายสะสม",
    color: "#2b2b2b",
    detail: {
      number: "BF-003",
      tagline: "เกราะดำขอบเงิน",
      smells: "ปลากัดหางสั้น ลำตัวดำเข้ม เกล็ดมีขอบสีเงินเรียงเหมือนชุดเกราะ",
      feel: "เข้ม ดุดัน ดูมีราคา",
      suits: ["คนที่ชอบปลาสีเข้ม ดูดุ", "นักสะสมที่อยากได้ลายหายาก", "คนที่มีตู้พร้อมแล้ว"],
      when: "ตู้ 5 ลิตรขึ้นไป พื้นหลังสีอ่อนจะทำให้ลายเกล็ดเด่นขึ้น",
    },
  },
  {
    id: "galaxy_koi",
    name: "Galaxy Koi",
    size: "ตัวเมีย · HMPK",
    price: 250,
    blurb: "ตัวเมียลายคาร์ปมีจุดประกายแบบกาแล็กซี่ ตัวเล็ก สีสวย วางโต๊ะทำงานได้",
    color: "#e08a4c",
    detail: {
      number: "BF-004",
      tagline: "ลายคาร์ปจุดประกาย",
      smells: "ปลากัดตัวเมียแบบ Halfmoon Plakat ลายคล้ายปลาคาร์ป มีจุดเล็กๆ ระยิบระยับทั่วตัว",
      feel: "น่ารัก สดใส ดูเพลินบนโต๊ะทำงาน",
      suits: ["คนที่อยากได้ปลาตัวเล็กสีสวยไว้บนโต๊ะ", "คนที่ชอบลายคาร์ป", "คนที่อยากเริ่มเลี้ยงแบบไม่ต้องดูแลหางยาว"],
      when: "ตัวเมียก็กัดกันได้ คนเพิ่งเริ่มควรเลี้ยงตู้ละตัว",
    },
  },
  {
    id: "nemo_candy",
    name: "Nemo Candy",
    size: "ตัวผู้ · Plakat หางสั้น",
    price: 390,
    blurb: "สีส้ม แดง ดำ ขาว เป็นแต้มๆ เหมือนปลาการ์ตูนหรือลูกอม สีไม่ซ้ำใคร",
    color: "#f39c12",
    detail: {
      number: "BF-005",
      tagline: "ลูกอมหลากสี",
      smells: "ปลากัดหางสั้น มีแต้มสีส้ม แดง ดำ และขาวทั่วตัว ลายของแต่ละตัวไม่ซ้ำกัน",
      feel: "สนุก สีสันจัด ดูแล้วอารมณ์ดี",
      suits: ["คนที่ชอบสีแปลกและลายไม่ซ้ำใคร", "คนที่อยากได้ปลาสีสดใส", "คนที่ชอบถ่ายรูปปลาลงโซเชียล"],
      when: "ตู้ 5 ลิตรขึ้นไป สีจะสดเมื่อน้ำสะอาดและอาหารดี",
    },
  },
];

/** Starter kit (5 L tank, pellets, water conditioner, almond leaves) added to a fish. Example price, see knowledge.md. */
export const KIT_PRICE = 390;

/** Points awarded once per user for each reason. Shown on the points page. */
export const POINT_RULES = {
  register: { points: 50, label: "สมัครสมาชิก" },
  friend: { points: 10, label: "เพิ่ม Aquatic Jewel เป็นเพื่อนใน LINE" },
  consent: { points: 20, label: "ยินยอมให้เก็บโปรไฟล์การเลี้ยงปลา (PDPA)" },
  waitlist: { points: 30, label: "ลงชื่อ pre-order" },
  survey: { points: 30, label: "ทำแบบสอบถามสายเลี้ยงปลา" },
} as const;

export type PointReason = keyof typeof POINT_RULES;

export function findProduct(id: unknown): Product | undefined {
  return PRODUCTS.find((p) => p.id === id);
}
