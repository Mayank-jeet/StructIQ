import { useEffect, useState } from "react";
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { explain } from "../api";
import Field from "./Field";
import StrengthRuler, { gradeFor } from "./StrengthRuler";

// [api field name, label, unit]; the order here is the order of the form
const FIELDS = [
  ["cement", "Cement", "kg/m³"],
  ["slag", "Blast furnace slag", "kg/m³"],
  ["fly_ash", "Fly ash", "kg/m³"],
  ["water", "Water", "kg/m³"],
  ["superplasticizer", "Superplasticizer", "kg/m³"],
  ["coarse_agg", "Coarse aggregate", "kg/m³"],
  ["fine_agg", "Fine aggregate", "kg/m³"],
  ["age_days", "Age at testing", "days"],
];

const DEFAULTS = {
  cement: 540, slag: 0, fly_ash: 0, water: 162,
  superplasticizer: 2.5, coarse_agg: 1040, fine_agg: 676, age_days: 28,
};

const AXIS = { fill: "var(--muted)", fontSize: 13 };
const LABELS = Object.fromEntries(FIELDS.map(([key, label]) => [key, label]));
const nice = (key) => LABELS[key] || key.replace(/_/g, " "); // age_days -> Age at testing, never raw snake_case

export default function PredictionPanel({ health }) {
  const [form, setForm] = useState(DEFAULTS);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function run(mix) {
    setError("");
    setLoading(true);
    try {
      setResult(await explain(mix)); // /explain returns the prediction AND its SHAP breakdown
    } catch (err) {
      setError(err.message);
      setResult(null); // never leave an old result on screen next to new inputs
    } finally {
      setLoading(false);
    }
  }

  // Show a real prediction straight away so the page opens on the answer, not an empty form.
  useEffect(() => {
    run(DEFAULTS);
  }, []);

  function submit(e) {
    e.preventDefault();
    const mix = {};
    for (const [key, label] of FIELDS) {
      if (form[key] === "" || Number.isNaN(Number(form[key]))) {
        setError(`Enter a number for ${label.toLowerCase()}.`);
        return;
      }
      mix[key] = Number(form[key]);
    }
    run(mix);
  }

  // biggest push first, so the chart reads like a ranked explanation
  const bars = result
    ? Object.entries(result.contributions)
        .map(([feature, value]) => ({ feature, value }))
        .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    : [];
  const grade = result ? gradeFor(result.predicted_mpa) : null;

  return (
    <div className="predict">
      <form className="mix" onSubmit={submit}>
        <h2>Mix design</h2>
        {FIELDS.map(([key, label, unit]) => (
          <Field
            key={key}
            label={label}
            unit={unit}
            value={form[key]}
            onChange={(e) => setForm({ ...form, [key]: e.target.value })}
          />
        ))}
        <div>
          <button className="primary" disabled={loading}>
            {loading ? "Predicting…" : "Update prediction"}
          </button>
          {error && <p className="error">{error}</p>}
        </div>
      </form>

      <div>
        {!result && <p className="muted">{loading ? "Predicting…" : "No prediction yet."}</p>}
        {result && (
          <>
            <section className="section">
              <h2>Predicted strength</h2>
              <div className="value">
                {result.predicted_mpa.toFixed(1)}
                <small>MPa</small>
              </div>
              <StrengthRuler value={result.predicted_mpa} error={health?.test_metrics?.rmse} />
              <p className="grade">{grade ? `Above the M${grade} level` : "Below the M20 level"}</p>
              {health?.test_metrics?.rmse && (
                <p className="muted small">Shaded band: typical error of ±{health.test_metrics.rmse.toFixed(1)} MPa</p>
              )}
              {result.out_of_range.length > 0 && (
                <p className="notice">Outside the training data: {result.out_of_range.map(nice).join(", ")}. Result unreliable.</p>
              )}
            </section>

            <section className="section">
              <h2>What drove it</h2>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={bars} layout="vertical" margin={{ left: 8, right: 24 }}>
                  <XAxis type="number" unit=" MPa" tick={AXIS} stroke="var(--rule)" />
                  <YAxis type="category" dataKey="feature" width={140} tick={AXIS} stroke="var(--rule)" tickFormatter={nice} />
                  <Tooltip
                    labelFormatter={nice}
                    formatter={(v) => `${v.toFixed(2)} MPa`}
                    contentStyle={{ background: "var(--sheet)", border: "1px solid var(--rule)", color: "var(--ink)" }}
                    cursor={{ fill: "var(--survey-soft)" }}
                  />
                  <ReferenceLine x={0} stroke="var(--muted)" />
                  <Bar dataKey="value">
                    {bars.map((b) => (
                      <Cell key={b.feature} fill={b.value >= 0 ? "var(--positive)" : "var(--negative)"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
