import pytest

from db.queries import DB_PATH, load_queries, run_query

pytestmark = pytest.mark.skipif(not DB_PATH.exists(), reason="run `python -m db.load_data` first")

EXPECTED = {
    "strength_by_cement_bucket",
    "error_by_strength_bin",
    "strength_gain_by_recipe",
    "worst_predictions_by_age",
    "wc_ratio_rolling_strength",
}


def test_all_named_queries_are_found():
    assert EXPECTED <= set(load_queries())


def test_unknown_query_name_is_rejected():
    with pytest.raises(KeyError):
        run_query("drop_table_mixes")


def test_cement_buckets_cover_every_row():
    df = run_query("strength_by_cement_bucket")
    assert len(df) == 4
    assert df["n_rows"].sum() == 1005


def test_error_bins_use_only_dev_out_of_fold_rows():
    df = run_query("error_by_strength_bin")
    assert df["n_rows"].sum() == 799
    assert df["bias"].iloc[-1] < 0  # strongest concrete is under-predicted


def test_strength_gain_first_row_per_recipe_has_no_previous():
    df = run_query("strength_gain_by_recipe")
    assert df["prev_age_days"].isna().sum() == df["recipe_id"].nunique()
    assert df.groupby("recipe_id").size().min() >= 2


def test_worst_predictions_ranked_within_each_age_group():
    df = run_query("worst_predictions_by_age")
    assert df.groupby("age_group").size().max() <= 3
    for _, g in df.groupby("age_group"):
        assert g["abs_error"].is_monotonic_decreasing


def test_wc_ratio_quartiles_and_age_filter():
    df = run_query("wc_ratio_rolling_strength")
    assert set(df["wc_quartile"]) == {1, 2, 3, 4}
    assert df["rolling_avg_10"].notna().all()
