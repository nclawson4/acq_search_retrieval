import { neon } from "@neondatabase/serverless";
import { DATABASE_URL } from "./env";

let _sql: ReturnType<typeof neon> | null = null;

export function sql() {
  if (!_sql) _sql = neon(DATABASE_URL());
  return _sql;
}
