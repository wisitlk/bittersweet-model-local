import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

/**
 * A real in-memory SQLite (node:sqlite) wearing the small part of the D1 API the Worker uses.
 * D1 is SQLite, so the real schema.sql and the real SQL run unchanged.
 */
export function createFakeD1(): D1Database {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(resolve(import.meta.dirname, "../schema.sql"), "utf8"));

  class Stmt {
    constructor(
      readonly sql: string,
      readonly params: SQLInputValue[] = [],
    ) {}
    bind(...values: unknown[]): Stmt {
      return new Stmt(this.sql, values as SQLInputValue[]);
    }
    async run() {
      const r = db.prepare(this.sql).run(...this.params);
      return { success: true, meta: { changes: Number(r.changes) } };
    }
    async first() {
      return db.prepare(this.sql).get(...this.params) ?? null;
    }
    async all() {
      return { results: db.prepare(this.sql).all(...this.params) };
    }
  }

  const fake = {
    prepare: (sql: string) => new Stmt(sql),
    async batch(stmts: Stmt[]) {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
    /** Test helper: run raw SQL and return all rows. */
    rows: (sql: string) => db.prepare(sql).all(),
  };
  return fake as unknown as D1Database;
}

export function rows(db: D1Database, sql: string): Record<string, unknown>[] {
  return (db as unknown as { rows: (s: string) => Record<string, unknown>[] }).rows(sql);
}
