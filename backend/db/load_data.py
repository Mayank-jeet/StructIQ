"""
Build the SQLite analytics database.

mixes every cleaned row (dev + test) with a stable mix_id and its split
predictions  one honest prediction per row from the final LightGBM
"""
import json
import sqlite3
from contextlib import closing
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from src.evaluate import regression_metrics
from src.features import BACKEND_DIR, DEV_PATH, FEATURES, TARGET, TEST_PATH
from src.train import ARTIFACTS_DIR, build_model, oof_predictions

DB_PATH = BACKEND_DIR / "db" / "structiq.db"
SCHEMA_PATH = BACKEND_DIR / "db" / "schema.sql"
MODEL_NAME = "lightgbm"


def make_mixes(dev: pd.DataFrame, test: pd.DataFrame) -> pd.DataFrame:
    """All rows in one table: a stable mix_id (1..N) and which split each row belongs to."""
    mixes = pd.concat([dev.assign(split="dev"), test.assign(split="test")], ignore_index=True)
    mixes.insert(0, "mix_id", range(1, len(mixes) + 1))
    return mixes[["mix_id", "recipe_id", *FEATURES, TARGET, "split"]]


def predict_all(mixes: pd.DataFrame, params: dict, final_model) -> pd.DataFrame:
    """One honest prediction per row.

    dev rows:  out-of-fold, so no row is scored by a model that saw its recipe
    test rows: the final model, which was trained on dev only
    """
    is_dev = (mixes["split"] == "dev").to_numpy()
    dev = mixes[is_dev]
    pred = np.zeros(len(mixes))
    pred[is_dev] = oof_predictions(
        lambda: build_model(MODEL_NAME, params), dev[FEATURES], dev[TARGET], dev["recipe_id"]
    )
    pred[~is_dev] = final_model.predict(mixes.loc[~is_dev, FEATURES])
    return pd.DataFrame({
        "mix_id": mixes["mix_id"],
        "model": MODEL_NAME,
        "predicted_mpa": pred,
        "kind": np.where(is_dev, "out_of_fold", "test"),
    })


def create_db(db_path: Path, mixes: pd.DataFrame, predictions: pd.DataFrame,
              schema_path: Path = SCHEMA_PATH) -> None:
    """Create the tables from schema.sql (which drops old ones first) and fill them."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(db_path)) as con, con:  # `with con` commits on success
        con.executescript(schema_path.read_text())
        mixes.to_sql("mixes", con, if_exists="append", index=False)
        predictions.to_sql("predictions", con, if_exists="append", index=False)


def main() -> None:
    dev, test = pd.read_csv(DEV_PATH), pd.read_csv(TEST_PATH)
    meta = json.loads((ARTIFACTS_DIR / "metadata.json").read_text())
    model = joblib.load(ARTIFACTS_DIR / "model.pkl")

    mixes = make_mixes(dev, test)
    preds = predict_all(mixes, meta["params"], model)
    create_db(DB_PATH, mixes, preds)

    # sanity check: the numbers in the database must match what the notebook reported
    merged = mixes.merge(preds, on="mix_id")
    for split, key in [("dev", "dev_cv_oof_metrics"), ("test", "test_metrics")]:
        part = merged[merged["split"] == split]
        got = regression_metrics(part[TARGET], part["predicted_mpa"])["rmse"]
        print(f"{split}: {len(part)} rows | RMSE here {got:.2f} | RMSE in metadata {meta[key]['rmse']:.2f}")
    print(f"saved: {DB_PATH}")


if __name__ == "__main__":
    main()
