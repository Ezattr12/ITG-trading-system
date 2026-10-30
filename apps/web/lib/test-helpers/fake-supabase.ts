import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A minimal in-memory stand-in for the Supabase JS client (Phase 12).
 *
 * Purpose: prove, at the query layer, that the read functions in
 * the queries modules scope every row to the signed-in trader.
 * The stub applies the recorded eq("user_id", ...) / in(...) /
 * not(...) filters to the rows it was seeded with, so a query
 * that forgot its user_id filter returns the other trader's
 * rows and the test fails — exactly the failure a missing filter
 * would cause against RLS-less data.
 *
 * It is NOT a Supabase emulator: it does not enforce RLS, it
 * does not run SQL, and it cannot prove anything about the live
 * database. Live RLS isolation is a Phase 13/14 test against
 * the real project (see docs/phase-12.md).
 */

export type Row = Record<string, unknown>;

type Op =
  | { kind: "eq"; col: string; value: unknown }
  | { kind: "in"; col: string; values: unknown[] }
  | { kind: "not"; col: string; op: string; value: unknown }
  | { kind: "is"; col: string; value: unknown }
  | { kind: "ilike"; col: string; pattern: string }
  | { kind: "gte"; col: string; value: string }
  | { kind: "lte"; col: string; value: string }
  | { kind: "order"; col: string; ascending: boolean }
  | { kind: "limit"; n: number };

interface FakeWriteHooks {
  onUpsert?: (table: string, row: Row, conflictCols: string[]) => Row;
  onUpdate?: (table: string, values: Row, matched: Row[]) => void;
  onDelete?: (table: string, matched: Row[]) => void;
}

/**
 * Result of a fake update/upsert: awaitable, error always
 * null. Phase 21 (M2): an upsert also carries the stored row
 * so `.select(...).single()` chains resolve it, as Postgrest
 * does for `upsert(...).select("id").single()`.
 */
export class FakeWrite {
  private readonly stored: Row | null;

  constructor(stored: Row | null = null) {
    this.stored = stored;
  }

  select(): this {
    return this;
  }

  async single(): Promise<{ data: Row | null; error: null }> {
    return { data: this.stored, error: null };
  }

  async maybeSingle(): Promise<{ data: Row | null; error: null }> {
    return this.single();
  }

  then<TResult1 = { data: null; error: null }, TResult2 = never>(
    onFulfilled?: ((value: { data: null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected);
  }
}

export class FakeQuery {
  readonly table: string;
  readonly ops: Op[] = [];
  private readonly rows: Row[];
  private readonly onInsert?: (table: string, row: Row) => Row;
  private readonly hooks?: FakeWriteHooks;
  private pendingUpdate: Row | null = null;
  private pendingDelete = false;

  constructor(
    table: string,
    rows: Row[],
    onInsert?: (table: string, row: Row) => Row,
    hooks?: FakeWriteHooks,
  ) {
    this.table = table;
    this.rows = rows;
    this.onInsert = onInsert;
    this.hooks = hooks;
  }

  select(): this {
    return this;
  }

  /**
   * Insert support (Phase 20): records the row on the owning
   * client and appends it to the table, so a later select in
   * the same test observes it — the behaviour the coach
   * refresh idempotency tests rely on.
   */
  insert(row: Row | Row[]): FakeInsert {
    const rows = Array.isArray(row) ? row : [row];
    const stored = rows.map((r) => (this.onInsert ? this.onInsert(this.table, r) : r));
    return new FakeInsert(stored);
  }

  /**
   * Update support (Phase 21): records the pending values;
   * the mutation is applied to the rows matched by the
   * recorded filters when the query is awaited — mirroring
   * Postgrest, where `.update(...).eq(...)` executes on the
   * request, not on the builder call.
   */
  update(values: Row): this {
    this.pendingUpdate = values;
    return this;
  }

  /**
   * Upsert support (Phase 21): merges the row into the table
   * immediately, replacing the row that matches every
   * `onConflict` column (or the id), else appending.
   */
  upsert(row: Row, opts?: { onConflict?: string }): FakeWrite {
    const conflictCols = (opts?.onConflict ?? "id")
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    const stored = this.hooks?.onUpsert?.(this.table, row, conflictCols) ?? null;
    return new FakeWrite(stored);
  }

  /**
   * Delete support (Phase 21, M2): records the pending
   * delete; the rows matched by the recorded filters are
   * removed from the table when the query is awaited —
   * mirroring Postgrest, where `.delete().eq(...)` executes
   * on the request, not on the builder call.
   */
  delete(): this {
    this.pendingDelete = true;
    return this;
  }

  eq(col: string, value: unknown): this {
    this.ops.push({ kind: "eq", col, value });
    return this;
  }

  in(col: string, values: unknown[]): this {
    this.ops.push({ kind: "in", col, values });
    return this;
  }

  not(col: string, op: string, value: unknown): this {
    this.ops.push({ kind: "not", col, op, value });
    return this;
  }

  is(col: string, value: unknown): this {
    this.ops.push({ kind: "is", col, value });
    return this;
  }

  ilike(col: string, pattern: string): this {
    this.ops.push({ kind: "ilike", col, pattern });
    return this;
  }

  gte(col: string, value: string): this {
    this.ops.push({ kind: "gte", col, value });
    return this;
  }

  lte(col: string, value: string): this {
    this.ops.push({ kind: "lte", col, value });
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }): this {
    this.ops.push({ kind: "order", col, ascending: opts?.ascending ?? true });
    return this;
  }

  limit(n: number): this {
    this.ops.push({ kind: "limit", n });
    return this;
  }

  /** Rows after every recorded filter / sort / limit, in order. */
  filteredRows(): Row[] {
    let out = [...this.rows];
    for (const op of this.ops) {
      switch (op.kind) {
        case "eq":
          out = out.filter((r) => r[op.col] === op.value);
          break;
        case "in":
          out = out.filter((r) => op.values.includes(r[op.col]));
          break;
        case "not":
          if (op.op === "is" && op.value === null) {
            out = out.filter((r) => r[op.col] !== null && r[op.col] !== undefined);
          }
          break;
        case "is":
          out = out.filter((r) =>
            op.value === null ? r[op.col] == null : r[op.col] === op.value,
          );
          break;
        case "ilike": {
          const needle = op.pattern.replace(/%/g, "").toLowerCase();
          out = out.filter((r) => String(r[op.col] ?? "").toLowerCase().includes(needle));
          break;
        }
        case "gte":
          out = out.filter((r) => String(r[op.col] ?? "") >= op.value);
          break;
        case "lte":
          out = out.filter((r) => String(r[op.col] ?? "") <= op.value);
          break;
        case "order": {
          const { col, ascending } = op;
          out = [...out].sort((a, b) => {
            const av = a[col];
            const bv = b[col];
            if (av == null && bv == null) return 0;
            if (av == null) return 1;
            if (bv == null) return -1;
            const cmp = av < bv ? -1 : av > bv ? 1 : 0;
            return ascending ? cmp : -cmp;
          });
          break;
        }
        case "limit":
          out = out.slice(0, op.n);
          break;
      }
    }
    return out;
  }

  async maybeSingle(): Promise<{ data: Row | null; error: null }> {
    const rows = this.filteredRows();
    return { data: rows[0] ?? null, error: null };
  }

  async single(): Promise<{ data: Row | null; error: null }> {
    return this.maybeSingle();
  }

  // Thenable, so `await query` and destructuring `{ data }` work
  // exactly as they do with the real Postgrest builder. When an
  // update is pending, awaiting applies it to the matched rows
  // and resolves the write result ({ data: null, error: null }),
  // as Postgrest does for `.update(...)` without `.select()`.
  then<TResult1 = { data: Row[]; count: number }, TResult2 = never>(
    onFulfilled?: ((value: { data: Row[]; count: number }) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    if (this.pendingDelete) {
      this.pendingDelete = false;
      const matched = this.filteredRows();
      for (const row of matched) {
        const idx = this.rows.indexOf(row);
        if (idx >= 0) this.rows.splice(idx, 1);
      }
      this.hooks?.onDelete?.(this.table, matched);
      return Promise.resolve({ data: null, error: null }).then(
        onFulfilled as unknown as
          | ((value: { data: null; error: null }) => TResult1 | PromiseLike<TResult1>)
          | null
          | undefined,
        onRejected,
      );
    }
    if (this.pendingUpdate) {
      const values = this.pendingUpdate;
      this.pendingUpdate = null;
      const matched = this.filteredRows();
      for (const row of matched) Object.assign(row, values);
      this.hooks?.onUpdate?.(this.table, values, matched);
      return Promise.resolve({ data: null, error: null }).then(
        onFulfilled as unknown as
          | ((value: { data: null; error: null }) => TResult1 | PromiseLike<TResult1>)
          | null
          | undefined,
        onRejected,
      );
    }
    const rows = this.filteredRows();
    return Promise.resolve({ data: rows, count: rows.length }).then(
      onFulfilled,
      onRejected,
    );
  }
}

/** Result of a fake insert: awaitable, plus .select().single() chains. */
export class FakeInsert {
  private readonly stored: Row[];

  constructor(stored: Row[]) {
    this.stored = stored;
  }

  select(): this {
    return this;
  }

  async single(): Promise<{ data: Row | null; error: null }> {
    return { data: this.stored[0] ?? null, error: null };
  }

  async maybeSingle(): Promise<{ data: Row | null; error: null }> {
    return this.single();
  }

  then<TResult1 = { data: null; error: null }, TResult2 = never>(
    onFulfilled?: ((value: { data: null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected);
  }
}

export class FakeSupabaseClient {
  /** Every query built, in call order — tests assert on these. */
  readonly queries: FakeQuery[] = [];
  /** Every inserted row, in call order: { table, row } (Phase 20). */
  readonly inserts: { table: string; row: Row }[] = [];
  /** Every applied update, in call order (Phase 21). */
  readonly updates: { table: string; values: Row; matched: Row[] }[] = [];
  /** Every upserted row, in call order (Phase 21). */
  readonly upserts: { table: string; row: Row }[] = [];
  /** Every deleted row, in call order (Phase 21, M2). */
  readonly deletes: { table: string; row: Row }[] = [];
  private readonly tables: Record<string, Row[]>;
  private insertSeq = 0;

  constructor(tables: Record<string, Row[]>) {
    this.tables = tables;
  }

  from(table: string): FakeQuery {
    const q = new FakeQuery(
      table,
      this.tables[table] ?? [],
      (t, row) => {
        const stored: Row = { ...row };
        if (stored.id === undefined) {
          this.insertSeq += 1;
          stored.id = `fake-${t}-${this.insertSeq}`;
        }
        (this.tables[t] ??= []).push(stored);
        this.inserts.push({ table: t, row: stored });
        return stored;
      },
      {
        onUpsert: (t, row, conflictCols) => {
          const rows = (this.tables[t] ??= []);
          const idx = rows.findIndex((r) =>
            conflictCols.every((c) => r[c] === row[c]),
          );
          let stored: Row;
          if (idx >= 0) {
            stored = { ...rows[idx], ...row };
            rows[idx] = stored;
          } else {
            stored = { ...row };
            if (stored.id === undefined) {
              this.insertSeq += 1;
              stored.id = `fake-${t}-${this.insertSeq}`;
            }
            rows.push(stored);
          }
          this.upserts.push({ table: t, row: stored });
          return stored;
        },
        onUpdate: (t, values, matched) => {
          this.updates.push({ table: t, values, matched });
        },
        onDelete: (t, matched) => {
          for (const row of matched) this.deletes.push({ table: t, row });
        },
      },
    );
    this.queries.push(q);
    return q;
  }

  /** All recorded inserts into one table, in call order. */
  insertsFor(table: string): Row[] {
    return this.inserts.filter((i) => i.table === table).map((i) => i.row);
  }

  /** All recorded updates applied to one table, in call order. */
  updatesFor(table: string): { values: Row; matched: Row[] }[] {
    return this.updates.filter((u) => u.table === table);
  }

  /** All recorded upserts into one table, in call order. */
  upsertsFor(table: string): Row[] {
    return this.upserts.filter((u) => u.table === table).map((u) => u.row);
  }

  /** All deleted rows from one table, in call order. */
  deletesFor(table: string): Row[] {
    return this.deletes.filter((d) => d.table === table).map((d) => d.row);
  }

  /** All queries run against one table, in call order. */
  queriesFor(table: string): FakeQuery[] {
    return this.queries.filter((q) => q.table === table);
  }
}

export function fakeSupabase(
  tables: Record<string, Row[]>,
): { client: SupabaseClient; fake: FakeSupabaseClient } {
  const fake = new FakeSupabaseClient(tables);
  return { client: fake as unknown as SupabaseClient, fake };
}

/** Assert a recorded query scoped a column to one value. */
export function assertScoped(
  query: FakeQuery,
  col: string,
  value: unknown,
): void {
  const hit = query.ops.some(
    (op) => op.kind === "eq" && op.col === col && op.value === value,
  );
  if (!hit) {
    throw new Error(
      `expected query on ${query.table} to filter ${col} = ${String(value)}; got ${JSON.stringify(query.ops)}`,
    );
  }
}
