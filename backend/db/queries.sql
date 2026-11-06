-- StructIQ analytical queries. Each block starts with "-- name: <id>".
-- Run with: python -m db.queries <id>
-- Tables: mixes (measured data), predictions (model output, kind = 'out_of_fold' | 'test')

-- name: strength_by_cement_bucket
-- Q1: how does average strength change as cement content rises?
SELECT
    CASE
        WHEN cement <= 200 THEN '1: up to 200'
        WHEN cement <= 300 THEN '2: 200-300'
        WHEN cement <= 400 THEN '3: 300-400'
        ELSE                    '4: 400+'
    END                             AS cement_bucket,
    COUNT(*)                        AS n_rows,
    ROUND(AVG(strength_mpa), 1)     AS avg_strength,
    ROUND(MIN(strength_mpa), 1)     AS min_strength,
    ROUND(MAX(strength_mpa), 1)     AS max_strength
FROM mixes
GROUP BY cement_bucket
ORDER BY cement_bucket;

-- name: error_by_strength_bin
-- Q2: where does the model fail? Error by true-strength bin (dev, out-of-fold).
-- Change 'out_of_fold' to 'test' to see the held-out set. Negative bias = under-prediction.
WITH scored AS (
    SELECT
        CASE
            WHEN m.strength_mpa <= 20 THEN '1: up to 20'
            WHEN m.strength_mpa <= 40 THEN '2: 20-40'
            WHEN m.strength_mpa <= 60 THEN '3: 40-60'
            ELSE                           '4: 60-90'
        END                                  AS strength_bin,
        p.predicted_mpa - m.strength_mpa     AS error
    FROM mixes m
    JOIN predictions p USING (mix_id)
    WHERE p.kind = 'out_of_fold'
)
SELECT
    strength_bin,
    COUNT(*)                            AS n_rows,
    ROUND(AVG(ABS(error)), 2)           AS mae,
    ROUND(SQRT(AVG(error * error)), 2)  AS rmse,
    ROUND(AVG(error), 2)                AS bias
FROM scored
GROUP BY strength_bin
ORDER BY strength_bin;

-- name: strength_gain_by_recipe
-- Q3: for recipes tested at several ages, how much strength is gained between tests?
-- Window functions look at neighbouring rows of the same recipe without collapsing rows.
WITH multi_age AS (
    SELECT recipe_id
    FROM mixes
    GROUP BY recipe_id
    HAVING COUNT(*) > 1
)
SELECT
    recipe_id,
    age_days,
    ROUND(strength_mpa, 1)                                   AS strength_mpa,
    LAG(age_days) OVER w                                     AS prev_age_days,
    ROUND(strength_mpa - LAG(strength_mpa) OVER w, 1)        AS gain_vs_prev_mpa,
    ROUND(strength_mpa - FIRST_VALUE(strength_mpa) OVER w, 1) AS gain_vs_first_mpa
FROM mixes
WHERE recipe_id IN (SELECT recipe_id FROM multi_age)
WINDOW w AS (PARTITION BY recipe_id ORDER BY age_days)
ORDER BY recipe_id, age_days;

-- name: worst_predictions_by_age
-- Q4: the 3 largest misses inside each age group (dev, out-of-fold).
WITH scored AS (
    SELECT
        m.mix_id,
        m.recipe_id,
        m.age_days,
        m.strength_mpa,
        p.predicted_mpa,
        ABS(p.predicted_mpa - m.strength_mpa) AS abs_error,
        CASE
            WHEN m.age_days <= 7  THEN '1: up to 7d'
            WHEN m.age_days <= 28 THEN '2: 8-28d'
            WHEN m.age_days <= 91 THEN '3: 29-91d'
            ELSE                       '4: 100d+'
        END AS age_group
    FROM mixes m
    JOIN predictions p USING (mix_id)
    WHERE p.kind = 'out_of_fold'
),
ranked AS (
    SELECT
        *,
        ROW_NUMBER() OVER (PARTITION BY age_group ORDER BY abs_error DESC) AS rank_in_group
    FROM scored
)
SELECT
    age_group,
    rank_in_group,
    mix_id,
    recipe_id,
    age_days,
    ROUND(strength_mpa, 1)  AS actual_mpa,
    ROUND(predicted_mpa, 1) AS predicted_mpa,
    ROUND(abs_error, 1)     AS abs_error
FROM ranked
WHERE rank_in_group <= 3
ORDER BY age_group, rank_in_group;

-- name: wc_ratio_rolling_strength
-- Q5: at a fixed age (28 days), strength vs water/cement ratio with a rolling average.
-- Lower water/cement ratio should mean higher strength (Abrams' law).
WITH base AS (
    SELECT
        mix_id,
        ROUND(water * 1.0 / cement, 3) AS wc_ratio,
        strength_mpa
    FROM mixes
    WHERE age_days = 28
)
SELECT
    mix_id,
    wc_ratio,
    ROUND(strength_mpa, 1) AS strength_mpa,
    ROUND(AVG(strength_mpa) OVER (
        ORDER BY wc_ratio, mix_id
        ROWS BETWEEN 9 PRECEDING AND CURRENT ROW
    ), 1)                  AS rolling_avg_10,
    NTILE(4) OVER (ORDER BY wc_ratio, mix_id) AS wc_quartile
FROM base
ORDER BY wc_ratio, mix_id;

-- name: experiment_pool
-- Pool of specimens for the Phase 4 A/B simulation: measured strength plus the honest
-- (out-of-fold) model prediction, which is later used as the CUPED covariate.
SELECT
    m.mix_id,
    m.strength_mpa,
    p.predicted_mpa
FROM mixes m
JOIN predictions p USING (mix_id)
WHERE p.kind = 'out_of_fold'
ORDER BY m.mix_id;
