import sqlite3

import pandas as pd
import pytest

from db.load_data import create_db, make_mixes
from src.features import FEATURES, TARGET


def tiny_frame(n, start):
    """n rows shaped like dev.csv / test.csv (recipe_id, 8 features, strength)."""
    rows = []
    for i in range(start, start + n):
        row = {"recipe_id": i, **{f: 1.0 for f in FEATURES}, TARGET: 30.0 + i}
        row["age_days"] = 28
        rows.append(row)
    return pd.DataFrame(rows)


def tiny_predictions(mixes):
    return pd.DataFrame({
        "mix_id": mixes["mix_id"],
        "model": "lightgbm",
        "predicted_mpa": mixes[TARGET] + 1.0,
        "kind": ["out_of_fold" if s == "dev" else "test" for s in mixes["split"]],
    })


def test_make_mixes_ids_and_split_labels():
    mixes = make_mixes(tiny_frame(4, 0), tiny_frame(2, 10))

    assert mixes["mix_id"].tolist() == [1, 2, 3, 4, 5, 6]
    assert mixes["split"].tolist() == ["dev"] * 4 + ["test"] * 2
    assert mixes.columns[0] == "mix_id" and mixes.columns[-1] == "split"


def test_create_db_loads_tables_and_join_works(tmp_path):
    mixes = make_mixes(tiny_frame(4, 0), tiny_frame(2, 10))
    db = tmp_path / "t.db"

    create_db(db, mixes, tiny_predictions(mixes))

    with sqlite3.connect(db) as con:
        n = con.execute("SELECT COUNT(*) FROM mixes JOIN predictions USING (mix_id)").fetchone()[0]
        kinds = con.execute("SELECT kind, COUNT(*) FROM predictions GROUP BY kind ORDER BY kind").fetchall()
    assert n == 6
    assert kinds == [("out_of_fold", 4), ("test", 2)]


def test_schema_rejects_a_bad_split_label(tmp_path):
    mixes = make_mixes(tiny_frame(2, 0), tiny_frame(1, 10))
    mixes.loc[0, "split"] = "val"  # not allowed by the CHECK constraint

    with pytest.raises((sqlite3.IntegrityError, pd.errors.DatabaseError)):
        create_db(tmp_path / "bad.db", mixes, tiny_predictions(mixes))
