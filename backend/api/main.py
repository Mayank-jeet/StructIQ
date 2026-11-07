"""StructIQ API: the single door between the dashboard and everything built in Phases 1-4.

Run from backend/:   uvicorn api.main:app --reload
Interactive docs:    http://127.0.0.1:8000/docs

Endpoints
    GET  /health            model + metrics, proves the service is alive
    POST /predict           mix design -> predicted strength (+ extrapolation warning)
    POST /explain           mix design -> prediction split into SHAP contributions
    GET  /queries           names of the available SQL analyses
    GET  /query/{name}      run one named SQL analysis, return rows as JSON
    POST /experiment        run the simulated A/B test, naive vs CUPED
"""
import json
import os
from contextlib import asynccontextmanager

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from db.queries import DB_PATH, load_queries, run_query
from src.experiment import (
    analyze_experiment,
    cuped_sd,
    monte_carlo,
    power_sample_size,
    simulate_experiment,
)
from src.explain import base_value, shap_values
from src.features import PROCESSED_PATH
from src.train import ARTIFACTS_DIR


# --------------------------------------------------------------------------- startup
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load the model once when the server starts, not on every request."""
    app.state.model = joblib.load(ARTIFACTS_DIR / "model.pkl")
    app.state.meta = json.loads((ARTIFACTS_DIR / "metadata.json").read_text())
    clean = pd.read_csv(PROCESSED_PATH)
    # the range of each feature the model has actually seen (used for the extrapolation warning)
    app.state.ranges = {f: (float(clean[f].min()), float(clean[f].max())) for f in app.state.meta["features"]}
    yield


app = FastAPI(title="StructIQ", version="1.0", lifespan=lifespan)

_raw_origins = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:3000,http://localhost:8501")
origins = [o.strip().rstrip("/") for o in _raw_origins.split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"], allow_headers=["*"])


# --------------------------------------------------------------------------- schemas
class MixInput(BaseModel):
    """One concrete mix. Bounds only reject physically impossible values; whether the mix is
    typical of the training data is reported separately by `out_of_range`."""

    cement: float = Field(ge=0, le=1000, description="kg per m3")
    slag: float = Field(ge=0, le=1000, description="blast furnace slag, kg per m3")
    fly_ash: float = Field(ge=0, le=1000, description="kg per m3")
    water: float = Field(ge=0, le=500, description="kg per m3")
    superplasticizer: float = Field(ge=0, le=100, description="kg per m3")
    coarse_agg: float = Field(ge=0, le=2000, description="kg per m3")
    fine_agg: float = Field(ge=0, le=2000, description="kg per m3")
    age_days: float = Field(ge=1, le=1000, description="age at testing, days")


class ExperimentRequest(BaseModel):
    true_effect: float = Field(2.0, ge=-20, le=20, description="MPa added to treated specimens")
    n_per_arm: int = Field(150, ge=10, le=1000)
    noise_sd: float = Field(0.0, ge=0, le=20, description="extra measurement noise, MPa")
    alpha: float = Field(0.05, gt=0, lt=0.5)
    seed: int = 42
    n_sims: int = Field(0, ge=0, le=500, description="0 = skip the repeated-experiment check")


# --------------------------------------------------------------------------- helpers
def _frame(mix: MixInput, state) -> pd.DataFrame:
    """One-row DataFrame in exactly the column order the model was trained with."""
    return pd.DataFrame([mix.model_dump()])[state.meta["features"]]


def _out_of_range(mix: MixInput, state) -> list[str]:
    """Features outside the training range. Tree models cannot extrapolate, so flag them."""
    values = mix.model_dump()
    return [f for f, (lo, hi) in state.ranges.items() if not lo <= values[f] <= hi]


def _require_db() -> None:
    if not DB_PATH.exists():
        raise HTTPException(503, "Database not built yet. Run `python -m db.load_data` first.")


# --------------------------------------------------------------------------- endpoints
@app.get("/health")
def health(request: Request):
    meta = request.app.state.meta
    return {"status": "ok", "model": meta["model"], "test_metrics": meta["test_metrics"]}


@app.post("/predict")
def predict(mix: MixInput, request: Request):
    state = request.app.state
    return {
        "predicted_mpa": float(state.model.predict(_frame(mix, state))[0]),
        "out_of_range": _out_of_range(mix, state),
    }


@app.post("/explain")
def explain(mix: MixInput, request: Request):
    state = request.app.state
    X = _frame(mix, state)
    contributions = shap_values(state.model, X).iloc[0]
    return {
        "predicted_mpa": float(state.model.predict(X)[0]),
        "base_value": base_value(state.model),  # prediction = base_value + sum(contributions)
        "contributions": {feature: float(v) for feature, v in contributions.items()},
        "out_of_range": _out_of_range(mix, state),
    }


@app.get("/queries")
def list_queries():
    return {"queries": list(load_queries())}


@app.get("/query/{name}")
def run_named_query(name: str):
    if name not in load_queries():
        raise HTTPException(404, f"Unknown query '{name}'.")
    _require_db()
    df = run_query(name)
    # pandas' own JSON writer turns NaN (SQL NULL) into null, which plain json.dumps cannot do
    return {"name": name, "columns": list(df.columns), "rows": json.loads(df.to_json(orient="records"))}


@app.post("/experiment")
def experiment(req: ExperimentRequest):
    _require_db()
    pool = run_query("experiment_pool")
    sd = float(pool["strength_mpa"].std(ddof=1))
    rho = float(pool["strength_mpa"].corr(pool["predicted_mpa"]))
    try:
        sim = simulate_experiment(pool, req.n_per_arm, req.true_effect, np.random.default_rng(req.seed), req.noise_sd)
    except ValueError as err:  # e.g. asking for more specimens than the pool holds
        raise HTTPException(422, str(err))

    result = {
        "true_effect": req.true_effect,
        "n_per_arm": req.n_per_arm,
        "pool_size": len(pool),
        "outcome_sd": sd,
        "correlation": rho,
        "analysis": analyze_experiment(sim["y"], sim["treatment"], sim["x"], req.alpha),
    }
    if req.true_effect != 0:  # sample-size planning needs a non-zero effect to aim for
        mde = abs(req.true_effect)
        result["required_n_per_arm"] = {
            "naive": power_sample_size(sd, mde, req.alpha),
            "cuped": power_sample_size(cuped_sd(sd, rho), mde, req.alpha),
        }
    if req.n_sims > 0:
        result["monte_carlo"] = monte_carlo(
            pool, req.n_per_arm, req.true_effect, req.n_sims, req.alpha, req.seed, req.noise_sd
        )
    return result
