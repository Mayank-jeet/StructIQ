import pandas as pd

from src.features import COLUMNS, add_recipe_id, clean, load_raw, split_dev_test


def make_df(rows):
    return pd.DataFrame(rows, columns=COLUMNS)


def synthetic(n_recipes=40, ages=(3, 7, 28)):
    """n_recipes distinct recipes, each tested at every age in `ages`."""
    rows = []
    for r in range(n_recipes):
        for a in ages:
            rows.append([100 + r, 0, 0, 150 + r, 0, 1000, 700, a, 20.0 + r + a / 10])
    return make_df(rows)


def test_clean_drops_exact_duplicates_only():
    rows = [
        [540, 0, 0, 162, 2.5, 1040, 676, 28, 80.0],
        [540, 0, 0, 162, 2.5, 1040, 676, 28, 80.0],  # exact copy -> dropped
        [540, 0, 0, 162, 2.5, 1040, 676, 3, 40.0],   # same recipe, other age -> kept
    ]
    out = clean(make_df(rows))
    assert len(out) == 2
    assert list(out.index) == [0, 1]


def test_same_recipe_different_age_shares_id():
    rows = [
        [540, 0, 0, 162, 2.5, 1040, 676, 28, 80.0],
        [540, 0, 0, 162, 2.5, 1040, 676, 3, 40.0],
        [540, 0, 0, 180, 2.5, 1040, 676, 28, 70.0],  # water differs -> new recipe
    ]
    ids = add_recipe_id(make_df(rows))["recipe_id"].tolist()
    assert ids == [0, 0, 1]


def test_split_never_shares_a_recipe():
    dev, test = split_dev_test(synthetic())
    assert set(dev["recipe_id"]).isdisjoint(set(test["recipe_id"]))
    assert len(dev) + len(test) == 120
    assert 0 < len(test) < 120


def test_split_is_reproducible():
    dev_a, test_a = split_dev_test(synthetic())
    dev_b, test_b = split_dev_test(synthetic())
    assert dev_a.equals(dev_b)
    assert test_a.equals(test_b)


def test_real_data_counts():
    df = clean(load_raw())
    assert len(df) == 1005
    dev, test = split_dev_test(df)
    assert dev["recipe_id"].nunique() + test["recipe_id"].nunique() == 428
