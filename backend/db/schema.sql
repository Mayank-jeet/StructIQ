-- StructIQ analytics database (SQLite).
-- Rebuilt from the CSVs and the trained model by db/load_data.py; never edited by hand.

PRAGMA foreign_keys = ON;

DROP TABLE IF EXISTS predictions;
DROP TABLE IF EXISTS mixes;

-- One row per cleaned concrete test (1,005 rows).
CREATE TABLE mixes (
    mix_id           INTEGER PRIMARY KEY,
    recipe_id        INTEGER NOT NULL,   -- same value = same 7 ingredient amounts, any age
    cement           REAL    NOT NULL CHECK (cement > 0),
    slag             REAL    NOT NULL CHECK (slag >= 0),
    fly_ash          REAL    NOT NULL CHECK (fly_ash >= 0),
    water            REAL    NOT NULL CHECK (water > 0),
    superplasticizer REAL    NOT NULL CHECK (superplasticizer >= 0),
    coarse_agg       REAL    NOT NULL CHECK (coarse_agg > 0),
    fine_agg         REAL    NOT NULL CHECK (fine_agg > 0),
    age_days         INTEGER NOT NULL CHECK (age_days > 0),
    strength_mpa     REAL    NOT NULL CHECK (strength_mpa > 0),
    split            TEXT    NOT NULL CHECK (split IN ('dev', 'test'))
);

-- One prediction per mix from the final model.
--   out_of_fold: dev rows, predicted by a model that never saw that recipe
--   test:        test rows, predicted by the final model trained on all of dev
CREATE TABLE predictions (
    mix_id        INTEGER PRIMARY KEY REFERENCES mixes (mix_id),
    model         TEXT NOT NULL,
    predicted_mpa REAL NOT NULL,
    kind          TEXT NOT NULL CHECK (kind IN ('out_of_fold', 'test'))
);

CREATE INDEX idx_mixes_recipe ON mixes (recipe_id);
CREATE INDEX idx_mixes_age    ON mixes (age_days);
