import type { DatabaseSync } from "node:sqlite";
import { DocStore, openDb } from "./db.js";
import type { Doc } from "./db.js";
import { COLLECTIONS } from "./types.js";
import type {
  AuditLogEntry,
  Collection,
  Customer,
  DeliveryLocation,
  Load,
  OpsState,
  Order,
  Product,
  Terminal,
  Contact,
} from "./types.js";
import { buildPortalUsers, buildSeed } from "./seed.js";

export const nowIso = (): string => new Date().toISOString();

/** Typed facade over the document store with the handful of helpers the
 *  modules, routes, and tools share. Business logic lives in the modules. */
export class OpsStore {
  readonly docs: DocStore;

  constructor(db?: DatabaseSync) {
    this.docs = new DocStore(db ?? openDb(process.env.VITEST ? ":memory:" : undefined));
    this.seedIfEmpty();
    this.migrate();
  }

  // ---- generic -----------------------------------------------------------

  all<T extends Doc>(c: Collection): T[] {
    return this.docs.list<T>(c);
  }

  find<T extends Doc>(c: Collection, id: string): T | undefined {
    return this.docs.get<T>(c, id);
  }

  require<T extends Doc>(c: Collection, id: string): T {
    const d = this.docs.get<T>(c, id);
    if (!d) throw new Error(`${c}: not found: ${id}`);
    return d;
  }

  save<T extends Doc>(c: Collection, doc: T): T {
    return this.docs.put(c, doc);
  }

  saveMany<T extends Doc>(c: Collection, docs: T[]): T[] {
    return this.docs.putMany(c, docs);
  }

  delete(c: Collection, id: string): boolean {
    return this.docs.remove(c, id);
  }

  /** Restart-safe sequential ids: prefix + (max numeric suffix + 1). */
  nextId(c: Collection, prefix: string): string {
    let max = 0;
    for (const d of this.docs.list<Doc>(c)) {
      if (d.id.startsWith(prefix)) {
        const n = parseInt(d.id.slice(prefix.length), 10);
        if (!Number.isNaN(n) && n > max) max = n;
      }
    }
    return `${prefix}${max + 1}`;
  }

  snapshot(): OpsState {
    const out = {} as Record<Collection, unknown[]>;
    for (const c of COLLECTIONS) out[c] = this.docs.list(c);
    return out as unknown as OpsState;
  }

  /** The snapshot the UI receives: full operational data, trimmed history. */
  uiSnapshot(now: Date = new Date()): OpsState {
    const s = this.snapshot();
    const rackSince = new Date(now.getTime() - 7 * 86_400_000).toISOString();
    const indexSince = new Date(now.getTime() - 35 * 86_400_000).toISOString().slice(0, 10);
    return {
      ...s,
      rackPrices: s.rackPrices.filter((r) => r.effectiveAt >= rackSince),
      indexPrices: s.indexPrices.filter((p) => p.date >= indexSince),
      customerPrices: s.customerPrices.slice(-200),
      auditLog: s.auditLog.slice(-150),
      // Staff can see who has a portal account, never the credentials or sessions.
      portalUsers: s.portalUsers.map((u) => ({ ...u, passwordHash: "", salt: "" })),
      portalSessions: [],
    };
  }

  audit(
    actorId: string,
    action: string,
    entityType: string,
    entityId: string,
    detail: string,
  ): AuditLogEntry {
    const entry: AuditLogEntry = {
      id: this.nextId("auditLog", "al-"),
      actorId,
      action,
      entityType,
      entityId,
      detail,
      occurredAt: nowIso(),
    };
    return this.save("auditLog", entry);
  }

  // ---- lookups used across modules ---------------------------------------

  customer(id: string): Customer {
    return this.require<Customer>("customers", id);
  }

  product(id: string): Product {
    return this.require<Product>("products", id);
  }

  terminal(id: string): Terminal {
    return this.require<Terminal>("terminals", id);
  }

  location(id: string): DeliveryLocation {
    return this.require<DeliveryLocation>("deliveryLocations", id);
  }

  order(id: string): Order {
    return this.require<Order>("orders", id);
  }

  load(id: string): Load {
    return this.require<Load>("loads", id);
  }

  findCustomerByName(query: string): Customer | undefined {
    const q = query.trim().toLowerCase();
    if (!q) return undefined;
    const all = this.all<Customer>("customers");
    return (
      all.find((c) => c.name.toLowerCase() === q || c.code.toLowerCase() === q) ??
      all.find((c) => c.name.toLowerCase().includes(q)) ??
      all.find((c) => tokenOverlap(c.name, query) >= 0.6)
    );
  }

  findProductByName(query: string): Product | undefined {
    const q = query.trim().toLowerCase();
    if (!q) return undefined;
    const all = this.all<Product>("products");
    return (
      all.find((p) => p.code.toLowerCase() === q || p.name.toLowerCase() === q) ??
      all.find((p) => p.name.toLowerCase().includes(q)) ??
      guessProduct(q, all)
    );
  }

  // ---- seeding -------------------------------------------------------------

  /**
   * Bring an existing database up to the current shape. Runs at startup after
   * seeding; each step is a no-op once applied.
   */
  migrate(now: Date = new Date()): string[] {
    const applied: string[] = [];
    if (this.all("portalUsers").length === 0 && this.all("customers").length > 0) {
      const users = buildPortalUsers(this.all<Customer>("customers"), this.all<Contact>("contacts"), now.toISOString());
      this.saveMany("portalUsers", users);
      this.audit("system", "migration.portal_accounts", "system", "portalUsers", `Created ${users.length} customer portal account(s) for existing customers`);
      applied.push("portal_accounts");
    }
    return applied;
  }

  seedIfEmpty(): void {
    if (this.docs.count("customers") > 0) return;
    this.reseed();
  }

  reseed(now: Date = new Date()): void {
    const data = buildSeed(now);
    this.docs.transaction(() => {
      this.docs.clearAll();
      for (const c of COLLECTIONS) {
        const rows = (data as unknown as Record<string, Doc[]>)[c] ?? [];
        for (const row of rows) this.docs.put(c, row);
      }
      this.docs.setMeta("seededAt", now.toISOString());
    });
  }
}

/** Share of the query's word tokens that appear in the candidate name. */
export function tokenOverlap(name: string, query: string): number {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1 && !["the", "and", "of", "inc", "llc", "co"].includes(t));
  const a = new Set(norm(name));
  const b = norm(query);
  if (b.length === 0) return 0;
  let hit = 0;
  for (const t of b) if (a.has(t) || [...a].some((x) => x.startsWith(t) || t.startsWith(x))) hit++;
  return hit / b.length;
}

/** Keyword heuristics for free-text product mentions ("dyed diesel", "regular", "93"). */
export function guessProduct(text: string, products: Product[]): Product | undefined {
  const t = text.toLowerCase();
  const byCode = (code: string) => products.find((p) => p.code === code);
  if (/\bdef\b|exhaust fluid/.test(t)) return byCode("DEF");
  if (/dyed|off[- ]?road|red diesel|farm diesel/.test(t)) return byCode("DYED");
  if (/\b93\b|premium|super/.test(t)) return byCode("PRM93");
  if (/\b87\b|regular|unleaded|gas\b|gasoline|e10/.test(t)) return byCode("UNL87");
  if (/diesel|ulsd|#2|on[- ]?road/.test(t)) return byCode("ULSD");
  return undefined;
}

/** Process-global singleton: the AG-UI bridge clones the agent per thread, so
 *  shared state must live at module level. */
export const ops = new OpsStore();
