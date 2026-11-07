import { useState } from "react";
import { runExperiment } from "../api";

const fmt = (v, d = 2) => Number(v).toFixed(d);
const pct = (v) => `${(v * 100).toFixed(1)}%`;

// Confidence intervals drawn as plain SVG: one row per analysis method.
function CiChart({ rows, trueEffect }) {
  const width = 560;
  const pad = 40;
  const rowH = 56;
  const height = rows.length * rowH + 50;
  const lo = Math.min(0, trueEffect, ...rows.map((r) => r.ci_low)) - 0.5;
  const hi = Math.max(0, trueEffect, ...rows.map((r) => r.ci_high)) + 0.5;
  const x = (v) => pad + ((v - lo) / (hi - lo)) * (width - 2 * pad);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="ci-chart">
      <line x1={x(0)} x2={x(0)} y1={10} y2={height - 30} stroke="#888" strokeDasharray="4 4" />
      <text x={x(0)} y={height - 14} textAnchor="middle" fontSize="12" fill="#888">no effect</text>
      <line x1={x(trueEffect)} x2={x(trueEffect)} y1={10} y2={height - 30} stroke="#2e9e5b" strokeDasharray="4 4" />
      <text x={x(trueEffect)} y={height - 2} textAnchor="middle" fontSize="12" fill="#2e9e5b">true effect</text>
      {rows.map((r, i) => {
        const y = 36 + i * rowH;
        return (
          <g key={r.label}>
            <line x1={x(r.ci_low)} x2={x(r.ci_high)} y1={y} y2={y} stroke="#3b6fd4" strokeWidth="3" />
            <line x1={x(r.ci_low)} x2={x(r.ci_low)} y1={y - 6} y2={y + 6} stroke="#3b6fd4" strokeWidth="3" />
            <line x1={x(r.ci_high)} x2={x(r.ci_high)} y1={y - 6} y2={y + 6} stroke="#3b6fd4" strokeWidth="3" />
            <circle cx={x(r.effect)} cy={y} r="5" fill="#3b6fd4" />
            <text x={x(r.ci_low)} y={y - 12} fontSize="13" fill="currentColor">{r.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

export default function ExperimentPanel() {
  const [form, setForm] = useState({ true_effect: "2", n_per_arm: "150", n_sims: "200", seed: "42" });
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const update = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError("");
    const body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, Number(v)]));
    if (Object.values(body).some((v) => Number.isNaN(v))) {
      setError("Every field must be a number.");
      return;
    }
    setLoading(true);
    try {
      setResult(await runExperiment(body));
    } catch (err) {
      setError(err.message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  const naive = result?.analysis.naive;
  const cuped = result?.analysis.cuped;
  const required = result?.required_n_per_arm;

  return (
    <div className="grid">
      <form className="card" onSubmit={submit}>
        <h2>Simulated A/B test: new curing method</h2>
        <p className="muted">
          Specimens are randomly split into two arms; the treated arm gets the true effect added to its strength.
          The same data is analysed twice: naively, and with CUPED (using the model's prediction to remove noise).
        </p>
        <div className="fields">
          <label>
            <span>True effect <small className="muted">(MPa)</small></span>
            <input type="number" step="any" value={form.true_effect} onChange={update("true_effect")} />
          </label>
          <label>
            <span>Specimens per arm</span>
            <input type="number" value={form.n_per_arm} onChange={update("n_per_arm")} />
          </label>
          <label>
            <span>Repeated runs <small className="muted">(0 = skip)</small></span>
            <input type="number" value={form.n_sims} onChange={update("n_sims")} />
          </label>
          <label>
            <span>Random seed</span>
            <input type="number" value={form.seed} onChange={update("seed")} />
          </label>
        </div>
        <button className="primary" disabled={loading}>
          {loading ? "Running…" : "Run experiment"}
        </button>
        {error && <p className="error">{error}</p>}
      </form>

      {result && (
        <>
          {required && (
            <div className="card">
              <h2>Sample size needed (80% power)</h2>
              <div className="stats">
                <div>
                  <div className="big">{required.naive}</div>
                  <span className="muted">per arm, naive</span>
                </div>
                <div>
                  <div className="big">{required.cuped}</div>
                  <span className="muted">per arm, with CUPED</span>
                </div>
                <div>
                  <div className="big">{pct(1 - required.cuped / required.naive)}</div>
                  <span className="muted">fewer specimens needed</span>
                </div>
              </div>
              <p className="muted">
                The model's prediction correlates {fmt(result.correlation, 3)} with measured strength, so CUPED removes
                about {pct(cuped.variance_reduction)} of the variance in this experiment.
              </p>
            </div>
          )}

          <div className="card">
            <h2>This experiment</h2>
            <CiChart
              trueEffect={result.true_effect}
              rows={[
                { label: "Naive", ...naive },
                { label: "CUPED", ...cuped },
              ]}
            />
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Method</th><th>Uplift (MPa)</th><th>95% CI</th><th>p-value</th><th>Significant</th>
                  </tr>
                </thead>
                <tbody>
                  {[["Naive", naive], ["CUPED", cuped]].map(([label, r]) => (
                    <tr key={label}>
                      <td>{label}</td>
                      <td>{fmt(r.effect)}</td>
                      <td>[{fmt(r.ci_low)}, {fmt(r.ci_high)}]</td>
                      <td>{r.p_value < 0.001 ? "<0.001" : fmt(r.p_value, 3)}</td>
                      <td>{r.p_value < 0.05 ? "yes" : "no"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {result.monte_carlo && (
            <div className="card">
              <h2>Repeated {form.n_sims} times</h2>
              <p className="muted">
                One experiment can be lucky. Reject rate is the power when the true effect is not zero, and the
                false-positive rate when it is zero. Coverage should be about 95%.
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Method</th><th>Mean uplift</th><th>Spread (sd)</th><th>Reject rate</th><th>CI coverage</th><th>CI width</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(result.monte_carlo).map(([method, m]) => (
                      <tr key={method}>
                        <td>{method === "cuped" ? "CUPED" : "Naive"}</td>
                        <td>{fmt(m.mean_effect)}</td>
                        <td>{fmt(m.sd_effect)}</td>
                        <td>{pct(m.reject_rate)}</td>
                        <td>{pct(m.ci_coverage)}</td>
                        <td>{fmt(m.mean_ci_width)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
