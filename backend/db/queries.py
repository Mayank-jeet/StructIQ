"""
Run the named queries in queries.sql.
"""
import re
import sqlite3
import sys
from contextlib import closing
from pathlib import Path

import pandas as pd

from src.features import BACKEND_DIR

DB_PATH = BACKEND_DIR / "db" / "structiq.db"
QUERIES_PATH = BACKEND_DIR / "db" / "queries.sql"


def load_queries(path: Path = QUERIES_PATH) -> dict[str, str]:
    """Split queries.sql into {name: sql} using the '-- name: <id>' marker lines."""
    parts = re.split(r"^-- name:\s*(\w+)\s*$", path.read_text(encoding="utf-8"), flags=re.MULTILINE)
    # parts = [preamble, name1, sql1, name2, sql2, ...]
    return {name: sql.strip() for name, sql in zip(parts[1::2], parts[2::2])}


def run_query(name: str, db_path: Path = DB_PATH, path: Path = QUERIES_PATH) -> pd.DataFrame:
    """Run one named query and return the result as a DataFrame."""
    queries = load_queries(path)
    if name not in queries:
        raise KeyError(f"Unknown query '{name}'. Available: {', '.join(queries)}")
    with closing(sqlite3.connect(db_path)) as con:
        return pd.read_sql_query(queries[name], con)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("available:", ", ".join(load_queries()))
    else:
        df = run_query(sys.argv[1])
        print(df.head(30).to_string(index=False))
        print(f"\n({len(df)} rows total)")
