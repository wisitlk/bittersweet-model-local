import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { ConciergeResponse } from "../src/claude";
import { buildCrmRow, CRM_COLUMNS } from "../src/crm";

const now = new Date("2026-10-08T10:00:00.000Z");

function resp(over: { handoff?: boolean; crm?: Partial<ConciergeResponse["crm"]> } = {}): ConciergeResponse {
  return {
    reply: "ok",
    handoff: over.handoff ?? false,
    crm: {
      save: false,
      consent_pdpa: false,
      segment: "",
      scents_smelled: "",
      liked: "",
      disliked: "",
      preferences: "",
      discovery_set_interest: false,
      preorder_waitlist: false,
      delete_request: false,
      ...over.crm,
    },
  };
}

const profile = {
  segment: "green_curious" as const,
  scents_smelled: "Cilantro",
  liked: "Cilantro",
  disliked: "",
  preferences: "work, fresh",
  discovery_set_interest: true,
};

describe("buildCrmRow", () => {
  it("uses exactly the columns of crm_schema.csv, in order", () => {
    const csv = readFileSync(resolve(import.meta.dirname, "fixtures/crm_schema.csv"), "utf8");
    expect(CRM_COLUMNS.join(",")).toBe(csv.trim());
    const row = buildCrmRow("U1", "hi", resp({ crm: { save: true, consent_pdpa: true } }), now);
    expect(Object.keys(row ?? {})).toEqual([...CRM_COLUMNS]);
  });

  it("returns null when nothing needs recording", () => {
    expect(buildCrmRow("U1", "hi", resp(), now)).toBeNull();
  });

  it("maps a consented save with the full profile", () => {
    const row = buildCrmRow("U1", "ok save", resp({ crm: { save: true, consent_pdpa: true, ...profile } }), now);
    expect(row).toMatchObject({
      timestamp: "2026-10-08T10:00:00.000Z",
      line_user_id: "U1",
      segment: "green_curious",
      scents_smelled: "Cilantro",
      discovery_set_interest: true,
      consent_pdpa: true,
      handoff: false,
      last_message: "ok save",
    });
  });

  it("takes handoff from the top level, not from crm", () => {
    const row = buildCrmRow("U1", "skin?", resp({ handoff: true }), now);
    expect(row?.handoff).toBe(true);
  });

  it("no consent: records a handoff but leaves every profile field empty", () => {
    const row = buildCrmRow("U1", "allergic", resp({ handoff: true, crm: { consent_pdpa: false, ...profile, preorder_waitlist: true } }), now);
    expect(row).toMatchObject({
      handoff: true,
      consent_pdpa: false,
      segment: "",
      scents_smelled: "",
      liked: "",
      disliked: "",
      preferences: "",
      discovery_set_interest: false,
      preorder_waitlist: false,
    });
  });

  it("no consent: records a delete request", () => {
    const row = buildCrmRow("U1", "delete me", resp({ crm: { delete_request: true } }), now);
    expect(row?.delete_request).toBe(true);
    expect(row?.segment).toBe("");
  });

  it("no consent: a pre-order or save alone is NOT recorded", () => {
    expect(buildCrmRow("U1", "x", resp({ crm: { preorder_waitlist: true } }), now)).toBeNull();
    expect(buildCrmRow("U1", "x", resp({ crm: { save: true, ...profile } }), now)).toBeNull();
  });

  it("consent + pre-order: recorded", () => {
    const row = buildCrmRow("U1", "x", resp({ crm: { consent_pdpa: true, preorder_waitlist: true } }), now);
    expect(row?.preorder_waitlist).toBe(true);
  });

  it("truncates last_message to 500 characters (consented rows)", () => {
    const row = buildCrmRow("U1", "ก".repeat(900), resp({ handoff: true, crm: { consent_pdpa: true } }), now);
    expect(row?.last_message).toHaveLength(500);
  });

  it("no consent: a handoff row has no message text, only id, timestamp and flags", () => {
    const row = buildCrmRow("U1", "I am allergic to musk", resp({ handoff: true, crm: { ...profile } }), now);
    expect(row).toEqual({
      timestamp: "2026-10-08T10:00:00.000Z",
      line_user_id: "U1",
      segment: "",
      scents_smelled: "",
      liked: "",
      disliked: "",
      preferences: "",
      discovery_set_interest: false,
      preorder_waitlist: false,
      consent_pdpa: false,
      handoff: true,
      delete_request: false,
      last_message: "",
    });
  });

  it("no consent: a delete request row has no message text either", () => {
    const row = buildCrmRow("U1", "delete me, I have asthma", resp({ crm: { delete_request: true } }), now);
    expect(row?.last_message).toBe("");
    expect(row?.delete_request).toBe(true);
  });

  it("does not cut an emoji in half when truncating", () => {
    const row = buildCrmRow("U1", "a".repeat(499) + "😀", resp({ handoff: true, crm: { consent_pdpa: true } }), now);
    expect(row?.last_message).toBe("a".repeat(499));
  });
});
