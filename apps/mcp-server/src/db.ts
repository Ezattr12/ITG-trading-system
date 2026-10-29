/**
 * The loose structural shape of a Supabase JS client as used by
 * this server. The query builder is intentionally typed `any`
 * at this boundary: the tool layer validates every row it gets
 * back into explicit local types, and tests inject a fake
 * client with the same surface.
 */
export interface DbClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
}
