import numpy as np
import pandas as pd
from lightgbm import LGBMRegressor

from src.explain import base_value, shap_values


def test_shap_values_add_up_to_prediction():
    rng = np.random.default_rng(0)
    X = pd.DataFrame(rng.normal(size=(200, 3)), columns=["a", "b", "c"])
    y = 3 * X["a"] - 2 * X["b"] + rng.normal(scale=0.1, size=200)
    model = LGBMRegressor(n_estimators=30, verbose=-1, random_state=0).fit(X, y)

    sv = shap_values(model, X)

    assert sv.shape == X.shape
    # the defining property of SHAP: base value + contributions = the prediction
    assert np.allclose(sv.sum(axis=1) + base_value(model), model.predict(X), atol=1e-3)
