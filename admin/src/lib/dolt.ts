import { Pool } from "pg";

const pool = new Pool({
  host: process.env.DOLT_HOST || "localhost",
  port: parseInt(process.env.DOLT_PORT || "5433"),
  database: process.env.DOLT_DATABASE || "lwf_staging",
  user: process.env.DOLT_USER || "root",
  password: process.env.DOLT_PASSWORD || "",
});

/**
 * Run a parameterized query and return all rows.
 *
 * DoltgreSQL gotchas:
 *  - Quote the "values" table name (reserved word)
 *  - No ILIKE — use LOWER(col) LIKE LOWER($1)
 *  - ENUMs are VARCHAR + CHECK constraints
 */
export async function query<T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] || null;
}

export default pool;
