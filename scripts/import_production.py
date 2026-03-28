"""Import production CSVs into DoltgreSQL staging database.

Prerequisites:
  1. DoltgreSQL installed and on PATH
  2. Database initialized:  mkdir lwf-staging && cd lwf-staging && doltgres init
  3. Server running:        doltgres --host 0.0.0.0 --port 5433
  4. Install driver:        pip install psycopg2-binary

Usage:
  python scripts/import_production.py
"""

import csv
import os
import sys

import psycopg2
from psycopg2.extras import execute_values

sys.stdout.reconfigure(encoding="utf-8")

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
CSV_DIR = os.path.join(REPO_ROOT, "LivingWithFire-DB")

DB_HOST = os.environ.get("DOLT_HOST", "localhost")
DB_PORT = int(os.environ.get("DOLT_PORT", "5433"))
DB_NAME = os.environ.get("DOLT_DB", "lwf_staging")
DB_USER = os.environ.get("DOLT_USER", "postgres")
DB_PASS = os.environ.get("DOLT_PASS", "password")

# Import order respects FK relationships
TABLES = [
    "plants",
    "attributes",
    "sources",
    "nurseries",
    "attribute_sources",
    "values",
    "plant_nurseries",
    "plant_images",
    "plant_research",
    "filter_presets",
    "key_terms",
    "resource_sections",
    "risk_reduction_snippets",
]

# Reserved words in PostgreSQL that need quoting when used as identifiers
RESERVED_IDENTIFIERS = {"values", "value", "key", "text"}


def quote_id(name):
    """Quote an identifier if it's a PostgreSQL reserved word."""
    if name.lower() in RESERVED_IDENTIFIERS:
        return f'"{name}"'
    return name


def connect():
    """Connect to DoltgreSQL."""
    conn = psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASS,
    )
    conn.autocommit = True
    return conn


def run_sql_file(conn, filepath):
    """Execute a SQL file against the connection."""
    with open(filepath, "r", encoding="utf-8") as f:
        sql = f.read()
    cur = conn.cursor()
    # Split on semicolons and execute each statement
    for statement in sql.split(";"):
        # Strip comments and whitespace to get the actual SQL
        lines = []
        for line in statement.split("\n"):
            stripped = line.strip()
            if stripped and not stripped.startswith("--"):
                lines.append(line)
        cleaned = "\n".join(lines).strip()
        if cleaned:
            try:
                cur.execute(cleaned)
            except psycopg2.Error as e:
                print(f"  SQL error: {e}")
                print(f"  Statement: {cleaned[:120]}...")
                raise
    cur.close()


def import_csv(conn, table_name, csv_path):
    """Import a CSV file into the given table. Returns row count."""
    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        headers = reader.fieldnames
        rows = list(reader)

    if not rows:
        print(f"  {table_name:30s}        0 rows (empty CSV)")
        return 0

    # Build column list with quoting
    col_names = [quote_id(h) for h in headers]
    col_list = ", ".join(col_names)
    quoted_table = quote_id(table_name)

    # Convert empty strings to None (SQL NULL)
    cleaned_rows = []
    for row in rows:
        cleaned = tuple(row[h] if row[h] != "" else None for h in headers)
        cleaned_rows.append(cleaned)

    # Batch insert using execute_values for performance
    cur = conn.cursor()
    placeholders = ", ".join(["%s"] * len(headers))
    insert_sql = f"INSERT INTO {quoted_table} ({col_list}) VALUES %s"

    try:
        execute_values(cur, insert_sql, cleaned_rows, page_size=1000)
    except psycopg2.Error:
        # Fallback to row-by-row insert if execute_values fails
        print(f"  Falling back to row-by-row insert for {table_name}...")
        insert_sql = f"INSERT INTO {quoted_table} ({col_list}) VALUES ({placeholders})"
        for i, row_tuple in enumerate(cleaned_rows):
            try:
                cur.execute(insert_sql, row_tuple)
            except psycopg2.Error as e:
                print(f"  Row {i+1} error: {e}")
                raise

    cur.close()
    print(f"  {table_name:30s} {len(rows):>8,} rows  ({len(headers)} cols)")
    return len(rows)


def verify_counts(conn, expected):
    """Verify row counts match expected values."""
    cur = conn.cursor()
    print("\nVerification:")
    all_ok = True
    for table_name, expected_count in expected.items():
        quoted_table = quote_id(table_name)
        cur.execute(f"SELECT COUNT(*) FROM {quoted_table}")
        actual = cur.fetchone()[0]
        status = "OK" if actual == expected_count else "MISMATCH"
        if status == "MISMATCH":
            all_ok = False
        print(f"  {table_name:30s} expected={expected_count:>8,}  actual={actual:>8,}  [{status}]")
    cur.close()
    return all_ok


def dolt_commit(conn, message):
    """Stage all changes and create a Dolt commit."""
    cur = conn.cursor()
    cur.execute("SELECT dolt_add('.')")
    cur.fetchone()
    cur.execute("SELECT dolt_commit('-m', %s)", (message,))
    result = cur.fetchone()
    cur.close()
    return result[0] if result else None


def dolt_log(conn, limit=3):
    """Print recent Dolt commits."""
    cur = conn.cursor()
    try:
        cur.execute(f"SELECT * FROM dolt_log ORDER BY date DESC LIMIT {limit}")
        rows = cur.fetchall()
        if rows:
            print("\nDolt log:")
            for row in rows:
                print(f"  {row}")
    except psycopg2.Error as e:
        print(f"\nCould not read dolt_log: {e}")
    cur.close()


def sample_query(conn):
    """Run a sample query to verify data integrity."""
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT p.genus, p.species, COUNT(v.id) AS value_count
            FROM plants p
            JOIN "values" v ON v.plant_id = p.id
            WHERE p.genus = 'Ceanothus' AND p.species = 'velutinus'
            GROUP BY p.genus, p.species
        """)
        row = cur.fetchone()
        if row:
            print(f"\nSample query — {row[0]} {row[1]}: {row[2]} values")
        else:
            print("\nSample query — Ceanothus velutinus: not found (check data)")
    except psycopg2.Error as e:
        print(f"\nSample query failed: {e}")
    cur.close()


def main():
    print("=" * 60)
    print("DoltgreSQL Staging Database Import")
    print(f"  Source:  {CSV_DIR}")
    print(f"  Target:  postgresql://{DB_USER}@{DB_HOST}:{DB_PORT}/{DB_NAME}")
    print("=" * 60)

    # Connect
    print("\nConnecting to DoltgreSQL...")
    conn = connect()
    print("  Connected.")

    # Create production mirror tables
    print("\nCreating production mirror tables...")
    staging_sql = os.path.join(SCRIPT_DIR, "create_staging_tables.sql")
    run_sql_file(conn, staging_sql)
    print("  Done.")

    # Create Claim/Warrant tables
    print("\nCreating Claim/Warrant tables...")
    warrant_sql = os.path.join(SCRIPT_DIR, "create_warrant_tables.sql")
    run_sql_file(conn, warrant_sql)
    print("  Done.")

    # Import CSVs
    print("\nImporting production CSVs...")
    expected_counts = {}
    for table_name in TABLES:
        csv_path = os.path.join(CSV_DIR, f"{table_name}.csv")
        if not os.path.exists(csv_path):
            print(f"  SKIP {table_name} (no CSV at {csv_path})")
            continue
        count = import_csv(conn, table_name, csv_path)
        expected_counts[table_name] = count

    # Verify row counts
    all_ok = verify_counts(conn, expected_counts)
    if not all_ok:
        print("\nWARNING: Row count mismatches detected!")
        sys.exit(1)

    # Verify Claim/Warrant tables exist (should be empty)
    cur = conn.cursor()
    cur.execute("""
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name
    """)
    tables = [row[0] for row in cur.fetchall()]
    cur.close()
    print(f"\nAll tables: {', '.join(tables)}")

    warrant_tables = {"warrants", "conflicts", "claims", "claim_warrants", "analysis_batches"}
    missing = warrant_tables - set(tables)
    if missing:
        print(f"WARNING: Missing Claim/Warrant tables: {missing}")
    else:
        print("Claim/Warrant tables verified (all 5 present).")

    # Dolt commit
    print("\nCreating initial Dolt commit...")
    total_values = expected_counts.get("values", 0)
    total_plants = expected_counts.get("plants", 0)
    total_attrs = expected_counts.get("attributes", 0)
    total_sources = expected_counts.get("sources", 0)
    commit_msg = (
        f"production mirror: {total_plants:,} plants, {total_values:,} values, "
        f"{total_attrs} attributes, {total_sources} sources + Claim/Warrant tables"
    )
    commit_hash = dolt_commit(conn, commit_msg)
    print(f"  Commit: {commit_hash}")

    # Show log
    dolt_log(conn)

    # Sample integrity check
    sample_query(conn)

    conn.close()
    print("\nImport complete.")


if __name__ == "__main__":
    main()
