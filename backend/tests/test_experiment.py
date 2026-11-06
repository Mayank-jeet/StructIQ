import numpy as np
import pandas as pd
import pytest
from scipy import stats

from src.experiment import (
    achieved_power,
    analyze_experiment,
    cuped_adjust,
    cuped_sd,
    monte_carlo,
    power_sample_size,
    simulate_experiment,
    welch_ttest,
)


@pytest.fixture
def synthetic_pool():
    """Fake specimens where the 'prediction' explains most of the strength (like our model)."""
    rng = np.random.default_rng(0)
    x = rng.normal(40, 15, size=1000)
    y = x + rng.normal(0, 5, size=1000)
    return pd.DataFrame({"strength_mpa": y, "predicted_mpa": x})


def test_power_sample_size_matches_textbook_value():
    # sd = mde = 1: 2 * (1.96 + 0.84)^2 = 15.7 -> 16 per arm
    assert power_sample_size(sd=1.0, mde=1.0) == 16


def test_power_sample_size_rejects_nonsense_inputs():
    with pytest.raises(ValueError):
        power_sample_size(sd=0, mde=1)


def test_achieved_power_is_alpha_when_effect_is_zero_and_rises_with_n():
    assert achieved_power(sd=10, n_per_arm=50, effect=0.0) == pytest.approx(0.05, abs=1e-6)
    assert achieved_power(10, 200, 3.0) > achieved_power(10, 50, 3.0)
    assert achieved_power(1.0, 16, 1.0) >= 0.79  # sample size from the test above gives ~80%


def test_cuped_sd_shrinks_with_correlation():
    assert cuped_sd(10, 0.0) == pytest.approx(10)
    assert cuped_sd(10, 0.94) < 4


def test_welch_ttest_matches_scipy():
    rng = np.random.default_rng(1)
    y = np.r_[rng.normal(10, 2, 40), rng.normal(11, 3, 60)]
    t = np.r_[np.zeros(40), np.ones(60)].astype(int)
    ours = welch_ttest(y, t)
    ref = stats.ttest_ind(y[t == 1], y[t == 0], equal_var=False)
    assert ours["p_value"] == pytest.approx(ref.pvalue, rel=1e-6)
    assert ours["effect"] == pytest.approx(y[t == 1].mean() - y[t == 0].mean())
    assert ours["ci_low"] < ours["effect"] < ours["ci_high"]


def test_welch_ttest_identical_groups_gives_p_one():
    y = np.r_[np.arange(1, 6), np.arange(1, 6)]
    t = np.r_[np.zeros(5), np.ones(5)].astype(int)
    res = welch_ttest(y, t)
    assert res["effect"] == pytest.approx(0.0)
    assert res["p_value"] == pytest.approx(1.0)


def test_cuped_with_perfect_covariate_removes_all_variance_and_keeps_mean():
    x = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
    y = 2 * x
    y_adj, theta, reduction = cuped_adjust(y, x)
    assert theta == pytest.approx(2.0)
    assert reduction == pytest.approx(1.0)
    assert y_adj.mean() == pytest.approx(y.mean())


def test_simulate_experiment_is_balanced_with_distinct_specimens(synthetic_pool):
    sim = simulate_experiment(synthetic_pool, 100, 2.0, np.random.default_rng(3))
    assert len(sim) == 200
    assert sim["treatment"].sum() == 100
    with pytest.raises(ValueError):
        simulate_experiment(synthetic_pool, 600, 2.0, np.random.default_rng(3))


def test_simulated_uplift_is_close_to_true_effect_on_average(synthetic_pool):
    summary = monte_carlo(synthetic_pool, 100, true_effect=2.0, n_sims=200, seed=5)
    for method in ("naive", "cuped"):
        assert summary[method]["mean_effect"] == pytest.approx(2.0, abs=0.5)


def test_cuped_beats_naive_on_precision_and_power(synthetic_pool):
    summary = monte_carlo(synthetic_pool, 100, true_effect=2.0, n_sims=300, seed=7)
    assert summary["cuped"]["sd_effect"] < summary["naive"]["sd_effect"]
    assert summary["cuped"]["mean_ci_width"] < summary["naive"]["mean_ci_width"]
    assert summary["cuped"]["reject_rate"] > summary["naive"]["reject_rate"]


def test_false_positive_rate_and_ci_coverage_are_calibrated(synthetic_pool):
    null = monte_carlo(synthetic_pool, 100, true_effect=0.0, n_sims=300, seed=11)
    for method in ("naive", "cuped"):
        assert 0.01 <= null[method]["reject_rate"] <= 0.10  # ~5% false positives
        assert 0.90 <= null[method]["ci_coverage"] <= 0.99  # ~95% coverage


def test_analyze_experiment_returns_both_analyses(synthetic_pool):
    sim = simulate_experiment(synthetic_pool, 100, 2.0, np.random.default_rng(9))
    res = analyze_experiment(sim["y"], sim["treatment"], sim["x"])
    assert set(res) == {"naive", "cuped"}
    assert res["cuped"]["variance_reduction"] > 0.5
    assert res["cuped"]["se"] < res["naive"]["se"]
