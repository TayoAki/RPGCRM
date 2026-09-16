import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Collection } from "./types.js";

/**
 * Document store on SQLite: one `docs` table keyed by (collection, id) with the
 * document as JSON. Small, dependency-free, and enough for the MVP's sample-size
 * data; the SaaS audit's Postgres migration replaces this layer wholesale.
 */

function defaultDbPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "data", "rpg.db");
}

export function openDb(filename?: string): DatabaseSync {
  const path = filename ?? process.env.RPG_DB_PATH ?? defaultDbPath();
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS docs (
      collection TEXT NOT NULL,
      id         TEXT NOT NULL,
      data       TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (collection, id)
    );
    CREATE INDEX IF NOT EXISTS docs_by_collection ON docs(collection);
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return db;
}

export interface Doc {
  id: string;
}

export class DocStore {
  constructor(readonly db: DatabaseSync) {}

  list<T extends Doc>(collection: Collection): T[] {
    const rows = this.db
      .prepare("SELECT data FROM docs WHERE collection = ? ORDER BY rowid")
      .all(collection) as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as T);
  }

  get<T extends Doc>(collection: Collection, id: string): T | undefined {
    const row = this.db
      .prepare("SELECT data FROM docs WHERE collection = ? AND id = ?")
      .get(collection, id) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as T) : undefined;
  }

  put<T extends Doc>(collection: Collection, doc: T): T {
    this.db
      .prepare(
        "INSERT INTO docs (collection, id, data, updated_at) VALUES (?, ?, ?, ?) " +
          "ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
      )
      .run(collection, doc.id, JSON.stringify(doc), new Date().toISOString());
    return doc;
  }

  putMany<T extends Doc>(collection: Collection, docs: T[]): T[] {
    this.transaction(() => {
      for (const d of docs) this.put(collection, d);
    });
    return docs;
  }

  remove(collection: Collection, id: string): boolean {
    const r = this.db
      .prepare("DELETE FROM docs WHERE collection = ? AND id = ?")
      .run(collection, id);
    return Number(r.changes) > 0;
  }

  clear(collection: Collection): void {
    this.db.prepare("DELETE FROM docs WHERE collection = ?").run(collection);
  }

  clearAll(): void {
    this.db.exec("DELETE FROM docs; DELETE FROM meta;");
  }

  count(collection: Collection): number {
    const row = this.db
      .prepare("SELECT count(*) AS n FROM docs WHERE collection = ?")
      .get(collection) as { n: number };
    return Number(row.n);
  }

  getMeta(key: string): string | undefined {
    const row = this.db
      .prepare("SELECT value FROM meta WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value;
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(key, value);
  }

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}
