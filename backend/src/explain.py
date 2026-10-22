"""SHAP explanations for the tree model.

SHAP splits each prediction into a baseline (the model's average output) plus
one contribution per feature:

    prediction = base_value + sum of the feature contributions

A positive contribution means the feature pushed the predicted strength up for
that row; negative means down. Units are MPa.
"""
import numpy as np
import pandas as pd
import shap


def shap_values(model, X: pd.DataFrame) -> pd.DataFrame:
    """One contribution per feature per row (same shape and labels as X)."""
    values = shap.TreeExplainer(model).shap_values(X)
    return pd.DataFrame(values, index=X.index, columns=X.columns)


def base_value(model) -> float:
    """The model's average output, the starting point every explanation adds to."""
    return float(np.ravel(shap.TreeExplainer(model).expected_value)[0])


def mean_abs_shap(sv: pd.DataFrame) -> pd.Series:
    """Global importance: average size of a feature's push on predictions (MPa), largest first."""
    return sv.abs().mean().sort_values(ascending=False)
