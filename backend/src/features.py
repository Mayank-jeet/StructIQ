"""Data loading and cleaning for StructIQ.

Single source of truth: notebooks, training code and the API all import from
here, so the cleaning steps can never drift apart.
"""
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import GroupShuffleSplit

BACKEND_DIR = Path(__file__).resolve().parents[1]
RAW_PATH = BACKEND_DIR / "data" / "raw" / "concrete.csv"
PROCESSED_PATH = BACKEND_DIR / "data" / "processed" / "concrete_clean.csv"
DEV_PATH = BACKEND_DIR / "data" / "processed" / "dev.csv"
TEST_PATH = BACKEND_DIR / "data" / "processed" / "test.csv"

COLUMNS = [
    "cement", "slag", "fly_ash", "water", "superplasticizer",
    "coarse_agg", "fine_agg", "age_days", "strength_mpa",
]
TARGET = "strength_mpa"
FEATURES = [c for c in COLUMNS if c != TARGET]
INGREDIENTS = [c for c in FEATURES if c != "age_days"]  # a 'recipe' = all ingredients, any age
TEST_SIZE = 0.2  # fraction of recipes (not rows) held out
SEED = 42
ENGINEERED = ["log_age", "water_cement_ratio"]


def load_raw(path: Path = RAW_PATH) -> pd.DataFrame:
    """Read the raw CSV and give the columns clean names. Raw file is never modified."""
    df = pd.read_csv(path)
    if df.shape[1] != len(COLUMNS):
        raise ValueError(f"Expected {len(COLUMNS)} columns, found {df.shape[1]}")
    df.columns = COLUMNS
    return df


def clean(df: pd.DataFrame) -> pd.DataFrame:
    """Drop exact duplicate rows (keep the first copy) and renumber the index.

    Done before any train/test split so identical rows cannot appear in both.
    """
    return df.drop_duplicates(keep="first").reset_index(drop=True)


def save_processed(df: pd.DataFrame, path: Path = PROCESSED_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(path, index=False)


def add_features(df: pd.DataFrame) -> pd.DataFrame:
    """Add two domain-driven features (returns a copy; the input is not modified).

    log_age: strength gain with age is curved (fast early, then flat); log straightens it
    water_cement_ratio: the classic concrete rule, less water per cement means stronger concrete
    """
    out = df.copy()
    out["log_age"] = np.log(out["age_days"])
    out["water_cement_ratio"] = out["water"] / out["cement"]
    return out


def add_recipe_id(df: pd.DataFrame) -> pd.DataFrame:
    """Give rows with the same recipe (all ingredients equal, any age) the same id.

    The same mix is often tested at several ages. Those rows are strongly
    related, so they must stay together when we split.
    """
    out = df.copy()
    out["recipe_id"] = out.groupby(INGREDIENTS, sort=False).ngroup()
    return out


def split_dev_test(df: pd.DataFrame, test_size: float = TEST_SIZE, seed: int = SEED):
    """Split by recipe, not by row, so no recipe appears in both dev and test.

    dev  = used for model selection (cross-validation, tuning)
    test = touched once, at the very end
    """
    df = add_recipe_id(df)
    splitter = GroupShuffleSplit(n_splits=1, test_size=test_size, random_state=seed)
    dev_idx, test_idx = next(splitter.split(df, groups=df["recipe_id"]))
    dev = df.iloc[dev_idx].reset_index(drop=True)
    test = df.iloc[test_idx].reset_index(drop=True)
    if not set(dev["recipe_id"]).isdisjoint(test["recipe_id"]):
        raise ValueError("Recipe leakage: a recipe appears in both dev and test")
    return dev, test


if __name__ == "__main__":
    raw = load_raw()
    df = clean(raw)
    save_processed(df)
    print(f"raw rows: {len(raw)} | clean rows: {len(df)} | removed: {len(raw) - len(df)}")

    dev, test = split_dev_test(df)
    save_processed(dev, DEV_PATH)
    save_processed(test, TEST_PATH)
    n_recipes = dev["recipe_id"].nunique() + test["recipe_id"].nunique()
    print(f"recipes: {n_recipes} | dev rows: {len(dev)} | test rows: {len(test)} ({len(test) / len(df):.1%})")
    print(f"mean strength  dev: {dev[TARGET].mean():.1f} | test: {test[TARGET].mean():.1f}")
