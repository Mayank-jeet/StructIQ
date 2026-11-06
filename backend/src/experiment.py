"""A/B experiment tooling: power analysis, Welch t-test, CUPED, Monte Carlo validation.

The UCI data is observational, so there is no real experiment in it. We *simulate* one:
pick specimens at random, randomly assign half to a new curing method, and add a known
true effect to their strength. Because we know the truth, we can check that every
statistical tool here recovers it (unbiased estimate, ~95% CI coverage, ~5% false positives).

    python -m src.experiment      # prints a naive vs CUPED comparison on the real pool
"""
import math

import numpy as np
import pandas as pd
from scipy import stats


# --------------------------------------------------------------------------- power analysis
def power_sample_size(sd: float, mde: float, alpha: float = 0.05, power: float = 0.8) -> int:
    """Units needed PER ARM to detect a difference of `mde` (two-sided, equal arms)."""
    if sd <= 0 or mde <= 0:
        raise ValueError("sd and mde must be positive")
    z_alpha = stats.norm.ppf(1 - alpha / 2)
    z_power = stats.norm.ppf(power)
    return math.ceil(2 * ((z_alpha + z_power) * sd / mde) ** 2)


def achieved_power(sd: float, n_per_arm: int, effect: float, alpha: float = 0.05) -> float:
    """Probability of detecting a true `effect` with n_per_arm units per arm."""
    se = sd * math.sqrt(2 / n_per_arm)
    z_alpha = stats.norm.ppf(1 - alpha / 2)
    z = abs(effect) / se
    return float(stats.norm.cdf(z - z_alpha) + stats.norm.cdf(-z - z_alpha))


def cuped_sd(sd: float, rho: float) -> float:
    """Outcome sd left after CUPED removes the part explained by a covariate with correlation rho."""
    return sd * math.sqrt(1 - rho**2)


# --------------------------------------------------------------------------- estimators
def welch_ttest(y, t, alpha: float = 0.05) -> dict:
    """Uplift (treated mean - control mean) with Welch standard error, CI and p-value."""
    y = np.asarray(y, dtype=float)
    t = np.asarray(t)
    y1, y0 = y[t == 1], y[t == 0]
    n1, n0 = len(y1), len(y0)
    v1, v0 = y1.var(ddof=1) / n1, y0.var(ddof=1) / n0
    effect = y1.mean() - y0.mean()
    se = math.sqrt(v1 + v0)
    df = (v1 + v0) ** 2 / (v1**2 / (n1 - 1) + v0**2 / (n0 - 1))  # Welch-Satterthwaite
    p_value = 2 * stats.t.sf(abs(effect / se), df)
    margin = stats.t.ppf(1 - alpha / 2, df) * se
    return {
        "effect": float(effect),
        "se": float(se),
        "ci_low": float(effect - margin),
        "ci_high": float(effect + margin),
        "p_value": float(p_value),
        "n_treatment": int(n1),
        "n_control": int(n0),
    }


def cuped_adjust(y, x):
    """CUPED: y_adj = y - theta * (x - mean(x)), theta = cov(x, y) / var(x), pooled over both arms.

    x must be measured BEFORE (or independently of) the treatment. Returns
    (y_adj, theta, variance_reduction) where variance_reduction = 1 - var(y_adj)/var(y).
    """
    y = np.asarray(y, dtype=float)
    x = np.asarray(x, dtype=float)
    theta = np.cov(x, y, ddof=1)[0, 1] / x.var(ddof=1)
    y_adj = y - theta * (x - x.mean())
    reduction = 1 - y_adj.var(ddof=1) / y.var(ddof=1)
    return y_adj, float(theta), float(reduction)


def analyze_experiment(y, t, x, alpha: float = 0.05) -> dict:
    """Run the naive analysis and the CUPED analysis on the same experiment."""
    y_adj, theta, reduction = cuped_adjust(y, x)
    cuped = welch_ttest(y_adj, t, alpha)
    cuped.update({"theta": theta, "variance_reduction": reduction})
    return {"naive": welch_ttest(y, t, alpha), "cuped": cuped}


# --------------------------------------------------------------------------- simulation
def simulate_experiment(
    pool: pd.DataFrame,
    n_per_arm: int,
    true_effect: float,
    rng: np.random.Generator,
    noise_sd: float = 0.0,
) -> pd.DataFrame:
    """Draw 2*n_per_arm distinct specimens, randomise them 50/50, add `true_effect` to treated ones.

    pool needs columns `strength_mpa` (outcome) and `predicted_mpa` (pre-treatment covariate).
    Returns columns y (outcome), treatment (0/1), x (covariate).
    """
    if 2 * n_per_arm > len(pool):
        raise ValueError(f"need {2 * n_per_arm} specimens but the pool has {len(pool)}")
    idx = rng.choice(len(pool), size=2 * n_per_arm, replace=False)
    treatment = rng.permutation(np.repeat([1, 0], n_per_arm))
    y = pool["strength_mpa"].to_numpy()[idx] + true_effect * treatment
    if noise_sd > 0:
        y = y + rng.normal(0.0, noise_sd, size=len(y))
    x = pool["predicted_mpa"].to_numpy()[idx]
    return pd.DataFrame({"y": y, "treatment": treatment, "x": x})


def monte_carlo(
    pool: pd.DataFrame,
    n_per_arm: int,
    true_effect: float,
    n_sims: int = 500,
    alpha: float = 0.05,
    seed: int = 42,
    noise_sd: float = 0.0,
) -> dict:
    """Repeat the experiment n_sims times; summarise how naive and CUPED analyses behave."""
    rng = np.random.default_rng(seed)
    results = {"naive": [], "cuped": []}
    for _ in range(n_sims):
        sim = simulate_experiment(pool, n_per_arm, true_effect, rng, noise_sd)
        res = analyze_experiment(sim["y"], sim["treatment"], sim["x"], alpha)
        for method in results:
            results[method].append(res[method])

    summary = {}
    for method, runs in results.items():
        effect = np.array([r["effect"] for r in runs])
        low = np.array([r["ci_low"] for r in runs])
        high = np.array([r["ci_high"] for r in runs])
        p = np.array([r["p_value"] for r in runs])
        summary[method] = {
            "mean_effect": float(effect.mean()),
            "sd_effect": float(effect.std(ddof=1)),
            "reject_rate": float((p < alpha).mean()),  # power if effect != 0, false-positive rate if 0
            "ci_coverage": float(((low <= true_effect) & (true_effect <= high)).mean()),
            "mean_ci_width": float((high - low).mean()),
        }
    return summary


# --------------------------------------------------------------------------- demo
def _demo() -> None:
    from db.queries import run_query

    pool = run_query("experiment_pool")
    sd = pool["strength_mpa"].std(ddof=1)
    rho = pool["strength_mpa"].corr(pool["predicted_mpa"])
    mde = 2.0
    print(f"pool: {len(pool)} specimens | sd = {sd:.2f} MPa | corr(strength, prediction) = {rho:.3f}")
    print(
        f"specimens per arm to detect {mde} MPa at 80% power: "
        f"naive = {power_sample_size(sd, mde)} | CUPED = {power_sample_size(cuped_sd(sd, rho), mde)}"
    )
    for effect in (mde, 0.0):
        summary = monte_carlo(pool, n_per_arm=150, true_effect=effect, n_sims=500)
        print(f"\ntrue effect = {effect} MPa | 150 per arm | 500 simulated experiments")
        print(pd.DataFrame(summary).T.round(3).to_string())


if __name__ == "__main__":
    _demo()
