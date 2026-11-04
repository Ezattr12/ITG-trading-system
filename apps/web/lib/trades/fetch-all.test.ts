import { describe, expect, it } from "vitest";
import { fakeSupabase } from "../test-helpers/fake-supabase";
import { fetchAllRows } from "./queries";

/**
 * fetchAllRows (Task 21) — the paginated fetch-all behind every
 * computation read. These tests pin the contract the figure-
 * integrity fix relies on: every row, in the query's order,
 * with no silent stop at a page boundary.
 */

interface Row {
  id: string;
  n: number;
}

function seed(count: number) {
  const rows = Array.from({ length: count }, (_, i) => ({
    id: `r-${i}`,
    n: i,
  }));
  return fakeSupabase({ items: rows });
}

function fetchItems(
  client: ReturnType<typeof fakeSupabase>["client"],
  pageSize?: number,
) {
  return fetchAllRows<Row>(
    (from, to) =>
      client
        .from("items")
        .select("id, n")
        .order("n", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: Row[] | null }>,
    pageSize,
  );
}

describe("fetchAllRows", () => {
  it("returns every row across page boundaries, in order", async () => {
    const { client, fake } = seed(1200);
    const rows = await fetchItems(client);
    expect(rows).toHaveLength(1200);
    expect(rows[0]!.n).toBe(0);
    expect(rows[1199]!.n).toBe(1199);
    // 500 + 500 + 200: three page queries, the last one short.
    const queries = fake.queriesFor("items");
    expect(queries).toHaveLength(3);
    expect(queries[2]!.ops).toContainEqual({ kind: "range", from: 1000, to: 1499 });
  });

  it("an exact multiple of the page size ends on an empty page, not a guess", async () => {
    const { client, fake } = seed(1000);
    const rows = await fetchItems(client);
    expect(rows).toHaveLength(1000);
    expect(fake.queriesFor("items")).toHaveLength(3);
  });

  it("a small result set costs exactly one page query", async () => {
    const { client, fake } = seed(8);
    const rows = await fetchItems(client);
    expect(rows).toHaveLength(8);
    expect(fake.queriesFor("items")).toHaveLength(1);
  });

  it("an empty table returns [] after one query", async () => {
    const { client, fake } = seed(0);
    await expect(fetchItems(client)).resolves.toEqual([]);
    expect(fake.queriesFor("items")).toHaveLength(1);
  });

  it("honours a caller-supplied page size", async () => {
    const { client } = seed(25);
    const rows = await fetchItems(client, 10);
    expect(rows.map((r) => r.n)).toEqual(Array.from({ length: 25 }, (_, i) => i));
  });
});
