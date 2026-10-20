import numpy as np
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
