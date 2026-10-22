"""Cross-validation and hyperparameter tuning (Optuna) for the tree models.

Same rule as everywhere else: folds are grouped by recipe_id, so a recipe never
appears in both the training and validation part of a fold.
"""
import json

import joblib
import numpy as np
import optuna
from lightgbm import LGBMRegressor
from sklearn.model_selection import GroupKFold
from xgboost import XGBRegressor

from src.evaluate import regression_metrics
from src.features import BACKEND_DIR

N_SPLITS = 5  # how we MEASURE the model; not something we tune
SEED = 42
ARTIFACTS_DIR = BACKEND_DIR / "artifacts"


def cv_rmse(make_model, X, y, groups, n_splits: int = N_SPLITS) -> np.ndarray:
    """RMSE of each fold. make_model() must return a fresh, untrained model."""
    scores = []
    for tr, va in GroupKFold(n_splits=n_splits).split(X, y, groups):
        model = make_model().fit(X.iloc[tr], y.iloc[tr])
        scores.append(regression_metrics(y.iloc[va], model.predict(X.iloc[va]))["rmse"])
    return np.array(scores)


def xgb_params(trial: optuna.Trial) -> dict:
    return {
        "n_estimators": trial.suggest_int("n_estimators", 100, 800),
        "learning_rate": trial.suggest_float("learning_rate", 0.01, 0.3, log=True),
        "max_depth": trial.suggest_int("max_depth", 2, 8),
        "min_child_weight": trial.suggest_int("min_child_weight", 1, 20),
        "subsample": trial.suggest_float("subsample", 0.6, 1.0),
        "colsample_bytree": trial.suggest_float("colsample_bytree", 0.6, 1.0),
        "reg_lambda": trial.suggest_float("reg_lambda", 1e-3, 10.0, log=True),
    }


def lgbm_params(trial: optuna.Trial) -> dict:
    return {
        "n_estimators": trial.suggest_int("n_estimators", 100, 800),
        "learning_rate": trial.suggest_float("learning_rate", 0.01, 0.3, log=True),
        "num_leaves": trial.suggest_int("num_leaves", 4, 128),
        "min_child_samples": trial.suggest_int("min_child_samples", 5, 50),
        "subsample": trial.suggest_float("subsample", 0.6, 1.0),
        "colsample_bytree": trial.suggest_float("colsample_bytree", 0.6, 1.0),
        "reg_lambda": trial.suggest_float("reg_lambda", 1e-3, 10.0, log=True),
    }


# name -> (search space, how to build a model from a params dict)
MODELS = {
    "xgboost": (xgb_params, lambda p: XGBRegressor(random_state=SEED, **p)),
    # subsample only takes effect in LightGBM when subsample_freq > 0
    "lightgbm": (lgbm_params, lambda p: LGBMRegressor(random_state=SEED, verbose=-1, subsample_freq=1, **p)),
}


def tune(name: str, X, y, groups, n_trials: int = 50, seed: int = SEED) -> optuna.Study:
    """Search for the hyperparameters with the lowest mean CV RMSE."""
    suggest, build = MODELS[name]

    def objective(trial):
        params = suggest(trial)
        return cv_rmse(lambda: build(params), X, y, groups).mean()

    optuna.logging.set_verbosity(optuna.logging.WARNING)
    study = optuna.create_study(direction="minimize", sampler=optuna.samplers.TPESampler(seed=seed))
    study.optimize(objective, n_trials=n_trials)
    return study


def build_model(name: str, params: dict):
    """Fresh model of the given type with the given (e.g. tuned) parameters."""
    return MODELS[name][1](params)


def save_model(model, metadata: dict, directory=ARTIFACTS_DIR) -> None:
    """Save the trained model (model.pkl) and a small metadata.json next to it.

    The metadata records the feature order, tuned params, scores and library
    version, so the API knows how to call the model and results can be traced.
    """
    directory.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, directory / "model.pkl")
    (directory / "metadata.json").write_text(json.dumps(metadata, indent=2))
