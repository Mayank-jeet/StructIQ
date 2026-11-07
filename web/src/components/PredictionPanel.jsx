import { useState } from "react";
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { explain } from "../api";

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

export default function PredictionPanel() {
  const [form, setForm] = useState(DEFAULTS);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const update = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError("");
    const mix = {};
    for (const [key, label] of FIELDS) {
      if (form[key] === "" || Number.isNaN(Number(form[key]))) {
        setError(`Enter a number for "${label}".`);
        return;
      }
      mix[key] = Number(form[key]);
    }
    setLoading(true);
    try {
      setResult(await explain(mix)); // /explain returns the prediction AND its SHAP breakdown
    } catch (err) {
      setError(err.message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  // biggest push first, so the chart reads like a ranked explanation
  const bars = result
    ? Object.entries(result.contributions)
        .map(([feature, value]) => ({ feature, value }))
        .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    : [];

  return (
    <div className="grid two">
      <form className="card" onSubmit={submit}>
        <h2>Mix design</h2>
        <div className="fields">
          {FIELDS.map(([key, label, unit]) => (
            <label key={key}>
              <span>
                {label} <small className="muted">({unit})</small>
              </span>
              <input type="number" step="any" value={form[key]} onChange={update(key)} />
            </label>
          ))}
        </div>
        <button className="primary" disabled={loading}>
          {loading ? "Predicting…" : "Predict strength"}
        </button>
        {error && <p className="error">{error}</p>}
      </form>

      <div className="card">
        <h2>Prediction</h2>
        {!result && <p className="muted">Fill in a mix and press the button.</p>}
        {result && (
          <>
            <div className="big">
              {result.predicted_mpa.toFixed(1)} <small>MPa</small>
            </div>
            {result.out_of_range.length > 0 && (
              <p className="warn">
                Outside the training data: {result.out_of_range.join(", ")}. Tree models cannot extrapolate, so
                treat this number with caution.
              </p>
            )}
            <p className="muted">
              Average prediction is {result.base_value.toFixed(1)} MPa. Each bar shows how much one ingredient
              pushed this mix above (green) or below (red) that average.
            </p>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={bars} layout="vertical" margin={{ left: 40, right: 20 }}>
                <XAxis type="number" unit=" MPa" />
                <YAxis type="category" dataKey="feature" width={120} />
                <Tooltip formatter={(v) => `${v.toFixed(2)} MPa`} />
                <ReferenceLine x={0} stroke="#888" />
                <Bar dataKey="value">
                  {bars.map((b) => (
                    <Cell key={b.feature} fill={b.value >= 0 ? "#2e9e5b" : "#d1495b"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </>
        )}
      </div>
    </div>
  );
}
