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

export class FakeQuery {
  readonly table: string;
  readonly ops: Op[] = [];
  private readonly rows: Row[];

  constructor(table: string, rows: Row[]) {
    this.table = table;
    this.rows = rows;
  }

  select(): this {
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
  // exactly as they do with the real Postgrest builder.
  then<TResult1 = { data: Row[]; count: number }, TResult2 = never>(
    onFulfilled?: ((value: { data: Row[]; count: number }) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const rows = this.filteredRows();
    return Promise.resolve({ data: rows, count: rows.length }).then(
      onFulfilled,
      onRejected,
    );
  }
}

export class FakeSupabaseClient {
  /** Every query built, in call order — tests assert on these. */
  readonly queries: FakeQuery[] = [];
  private readonly tables: Record<string, Row[]>;

  constructor(tables: Record<string, Row[]>) {
    this.tables = tables;
  }

  from(table: string): FakeQuery {
    const q = new FakeQuery(table, this.tables[table] ?? []);
    this.queries.push(q);
    return q;
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
