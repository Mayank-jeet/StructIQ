import pytest
from fastapi.testclient import TestClient

from api.main import app
from db.queries import DB_PATH

pytestmark = pytest.mark.skipif(not DB_PATH.exists(), reason="run `python -m db.load_data` first")

TYPICAL_MIX = {
    "cement": 540.0,
    "slag": 0.0,
    "fly_ash": 0.0,
    "water": 162.0,
    "superplasticizer": 2.5,
    "coarse_agg": 1040.0,
    "fine_agg": 676.0,
    "age_days": 28,
}


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:  # the `with` runs the startup code that loads the model
        yield c


def test_health_reports_model_and_metrics(client):
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["model"] == "lightgbm"
    assert body["test_metrics"]["rmse"] > 0


def test_predict_returns_plausible_strength_for_a_typical_mix(client):
    body = client.post("/predict", json=TYPICAL_MIX).json()
    assert 40 < body["predicted_mpa"] < 100
    assert body["out_of_range"] == []


def test_predict_flags_features_outside_the_training_range(client):
    body = client.post("/predict", json={**TYPICAL_MIX, "cement": 900.0}).json()
    assert "cement" in body["out_of_range"]


def test_predict_rejects_impossible_or_missing_input(client):
    assert client.post("/predict", json={**TYPICAL_MIX, "cement": -5}).status_code == 422
    incomplete = {k: v for k, v in TYPICAL_MIX.items() if k != "water"}
    assert client.post("/predict", json=incomplete).status_code == 422


def test_explain_contributions_add_up_to_the_prediction(client):
    body = client.post("/explain", json=TYPICAL_MIX).json()
    total = body["base_value"] + sum(body["contributions"].values())
    assert total == pytest.approx(body["predicted_mpa"], abs=1e-3)
    assert set(body["contributions"]) == set(TYPICAL_MIX)


def test_query_endpoints_list_run_and_reject_unknown_names(client):
    assert "error_by_strength_bin" in client.get("/queries").json()["queries"]
    body = client.get("/query/error_by_strength_bin").json()
    assert len(body["rows"]) == 4
    assert "bias" in body["columns"]
    assert client.get("/query/drop_table_mixes").status_code == 404


def test_query_with_null_values_is_valid_json(client):
    rows = client.get("/query/strength_gain_by_recipe").json()["rows"]
    assert rows[0]["prev_age_days"] is None  # first test of a recipe has no previous test


def test_experiment_cuped_is_more_precise_than_naive(client):
    body = client.post("/experiment", json={}).json()
    assert body["analysis"]["cuped"]["se"] < body["analysis"]["naive"]["se"]
    assert body["required_n_per_arm"]["cuped"] < body["required_n_per_arm"]["naive"]
    assert "monte_carlo" not in body


def test_experiment_monte_carlo_and_zero_effect(client):
    body = client.post("/experiment", json={"true_effect": 0, "n_sims": 20}).json()
    assert "required_n_per_arm" not in body
    assert body["monte_carlo"]["cuped"]["ci_coverage"] >= 0.0


def test_experiment_rejects_more_specimens_than_the_pool_holds(client):
    assert client.post("/experiment", json={"n_per_arm": 500}).status_code == 422
