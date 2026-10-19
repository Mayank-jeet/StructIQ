"""Data loading and cleaning for StructIQ.

Single source of truth: notebooks, training code and the API all import from
here, so the cleaning steps can never drift apart.

Run from the backend/ folder to regenerate the processed file:
    python -m src.features
"""
from pathlib import Path

import pandas as pd

BACKEND_DIR = Path(__file__).resolve().parents[1]
RAW_PATH = BACKEND_DIR / "data" / "raw" / "concrete.csv"
PROCESSED_PATH = BACKEND_DIR / "data" / "processed" / "concrete_clean.csv"

# Column order is fixed by the UCI file. We rename by position because the
# original headers are long and messy (units, double spaces, trailing space).
COLUMNS = [
    "cement", "slag", "fly_ash", "water", "superplasticizer",
    "coarse_agg", "fine_agg", "age_days", "strength_mpa",
]
TARGET = "strength_mpa"
FEATURES = [c for c in COLUMNS if c != TARGET]


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


if __name__ == "__main__":
    raw = load_raw()
    df = clean(raw)
    save_processed(df)
    print(f"raw rows: {len(raw)} | clean rows: {len(df)} | removed: {len(raw) - len(df)}")
    print(f"saved to: {PROCESSED_PATH}")
