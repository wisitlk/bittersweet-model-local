import { describe, expect, it } from "vitest";
import { withShopLink } from "../src/handler";

describe("withShopLink", () => {
  it("adds the shop link only when the reply points to หน้าร้าน", () => {
    expect(withShopLink("สั่งได้ที่หน้าร้านเลยครับ", "2001-Ab")).toBe(
      "สั่งได้ที่หน้าร้านเลยครับ\n\nหน้าร้าน: https://liff.line.me/2001-Ab?tab=shop",
    );
    expect(withShopLink("Slow Morning กลิ่นชาเขียวครับ", "2001-Ab")).toBe("Slow Morning กลิ่นชาเขียวครับ");
    expect(withShopLink("หน้าร้าน https://liff.line.me/x", "2001-Ab")).toBe("หน้าร้าน https://liff.line.me/x");
    expect(withShopLink("ที่หน้าร้าน", undefined)).toBe("ที่หน้าร้าน");
  });
});
