import json

import joblib
import numpy as np
import pandas as pd
from lightgbm import LGBMRegressor
from sklearn.linear_model import LinearRegression

from src.train import cv_rmse, save_model


def test_cv_rmse_one_score_per_fold():
    rng = np.random.default_rng(0)
    X = pd.DataFrame(rng.normal(size=(100, 2)), columns=["a", "b"])
    y = X["a"] + 0.1 * rng.normal(size=100)
    groups = pd.Series(np.repeat(np.arange(50), 2))  # 50 "recipes" with 2 rows each

    scores = cv_rmse(LinearRegression, X, y, groups)

    assert scores.shape == (5,)
    assert (scores > 0).all()


def test_save_model_roundtrip(tmp_path):
    X = pd.DataFrame({"a": np.arange(50.0), "b": np.arange(50.0)[::-1]})
    y = X["a"] * 2
    model = LGBMRegressor(n_estimators=5, min_child_samples=2, verbose=-1).fit(X, y)

    save_model(model, {"features": ["a", "b"]}, directory=tmp_path)

    loaded = joblib.load(tmp_path / "model.pkl")
    assert np.allclose(loaded.predict(X), model.predict(X))
    assert json.loads((tmp_path / "metadata.json").read_text())["features"] == ["a", "b"]
