import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score


def regression_metrics(y_true, y_pred) -> dict:
    """The three numbers we report for every model, in the units of the target (MPa)
    except R2, which is unitless.

    rmse: typical error, punishes big misses more
    mae:  average absolute error, easiest to read
    r2:   share of the variation in strength the model explains (1 = perfect, 0 = no better than the mean)
    """
    return {
        "rmse": float(np.sqrt(mean_squared_error(y_true, y_pred))),
        "mae": float(mean_absolute_error(y_true, y_pred)),
        "r2": float(r2_score(y_true, y_pred)),
    }


def error_by_bin(df: pd.DataFrame, col: str, bins, pred: str = "pred", target: str = "strength_mpa") -> pd.DataFrame:
    """Where does the model miss? Error of the predictions inside each bin of `col`.

    n:    rows in the bin
    mae:  average absolute error (MPa)
    rmse: typical error (MPa)
    bias: mean of (pred - true); negative = the model under-predicts in this bin
    """
    d = df.assign(_bin=pd.cut(df[col], bins=bins, include_lowest=True), _err=df[pred] - df[target])
    g = d.groupby("_bin", observed=True)["_err"]
    out = pd.DataFrame({
        "n": g.size(),
        "mae": g.apply(lambda e: e.abs().mean()),
        "rmse": g.apply(lambda e: np.sqrt((e ** 2).mean())),
        "bias": g.mean(),
    })
    return out.round(2)
