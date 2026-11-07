import { useEffect, useState } from "react";
import { runExperiment } from "../api";
import Field from "./Field";

const fmt = (v, d = 2) => Number(v).toFixed(d);
const pct = (v) => `${(v * 100).toFixed(0)}%`;

const DEFAULTS = { true_effect: "2", n_per_arm: "150", n_sims: "200", seed: "42" };

// Confidence intervals as plain SVG: one row per analysis method.
function CiChart({ rows, trueEffect }) {
  const width = 600;
  const pad = 44;
  const rowH = 58;
  const height = rows.length * rowH + 56;
  const lo = Math.min(0, trueEffect, ...rows.map((r) => r.ci_low)) - 0.5;
  const hi = Math.max(0, trueEffect, ...rows.map((r) => r.ci_high)) + 0.5;
  const x = (v) => pad + ((v - lo) / (hi - lo)) * (width - 2 * pad);
  const bottom = height - 34;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="ci-chart" role="img" aria-label="Estimated gain with its confidence interval">
      <line x1={x(0)} x2={x(0)} y1={8} y2={bottom} stroke="var(--muted)" strokeDasharray="4 4" />
      <text x={x(0)} y={height - 16} textAnchor="middle" className="quiet">no gain</text>
      <line x1={x(trueEffect)} x2={x(trueEffect)} y1={8} y2={bottom} stroke="var(--positive)" strokeWidth="2" strokeDasharray="4 4" />
      <text x={x(trueEffect)} y={height - 2} textAnchor="middle" style={{ fill: "var(--positive)" }}>
        true gain
      </text>
      {rows.map((r, i) => {
        const y = 38 + i * rowH;
        return (
          <g key={r.label}>
            <line x1={x(r.ci_low)} x2={x(r.ci_high)} y1={y} y2={y} stroke="var(--steel)" strokeWidth="4" />
            <line x1={x(r.ci_low)} x2={x(r.ci_low)} y1={y - 7} y2={y + 7} stroke="var(--steel)" strokeWidth="3" />
            <line x1={x(r.ci_high)} x2={x(r.ci_high)} y1={y - 7} y2={y + 7} stroke="var(--steel)" strokeWidth="3" />
            <circle cx={x(r.effect)} cy={y} r="6" fill="var(--survey)" stroke="var(--ink)" strokeWidth="2" />
            <text x={x(r.ci_low)} y={y - 14}>{r.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

// Two horizontal bars: the first is the full width, the second is scaled against it.
function Bars({ first, second }) {
  return (
    <div className="need">
      {[first, second].map((b, i) => (
        <div className="row" key={b.label}>
          <span>{b.label}</span>
          <div className={i ? "fill cuped" : "fill"} style={{ width: `${Math.max(b.share * 100, 0)}%` }}>
            {b.text}
          </div>
        </div>
      ))}
    </div>
  );
}

function verdict(naive, cuped) {
  const a = naive.p_value < 0.05;
  const b = cuped.p_value < 0.05;
  if (a && b) return "Both tests detect the gain.";
  if (b) return "CUPED detects the gain. The plain test misses it.";
  if (a) return "Only the plain test detects the gain.";
  return "Neither test detects the gain.";
}

export default function ExperimentPanel() {
  const [form, setForm] = useState(DEFAULTS);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function run(settings) {
    setError("");
    setLoading(true);
    try {
      setResult(await runExperiment(settings));
    } catch (err) {
      setError(err.message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  // Run the default experiment on load so the page opens on a finished result.
  useEffect(() => {
    run(Object.fromEntries(Object.entries(DEFAULTS).map(([k, v]) => [k, Number(v)])));
  }, []);

  const update = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  function submit(e) {
    e.preventDefault();
    const body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === "" ? NaN : Number(v)]));
    if (Object.values(body).some((v) => Number.isNaN(v))) {
      setError("Every field needs a number.");
      return;
    }
    run(body);
  }

  const naive = result?.analysis.naive;
  const cuped = result?.analysis.cuped;
  const required = result?.required_n_per_arm;
  const mc = result?.monte_carlo;

  return (
    <div>
      <section className="section">
        <h2>Does the new curing method work?</h2>
        <form onSubmit={submit}>
          <div className="setup">
            <Field label="True strength gain" unit="MPa" value={form.true_effect} onChange={update("true_effect")} />
            <Field label="Specimens per group" value={form.n_per_arm} onChange={update("n_per_arm")} />
            <Field label="Repeat the test" unit="times" value={form.n_sims} onChange={update("n_sims")} />
            <Field label="Random seed" value={form.seed} onChange={update("seed")} />
          </div>
          <button className="primary" disabled={loading}>
            {loading ? "Running…" : "Run experiment"}
          </button>
          {error && <p className="error">{error}</p>}
        </form>
      </section>

      {result && (
        <>
          <section className="section">
            <h2>This experiment</h2>
            <p className="verdict">{verdict(naive, cuped)}</p>
            <CiChart
              trueEffect={result.true_effect}
              rows={[
                { label: "Plain", ...naive },
                { label: "CUPED", ...cuped },
              ]}
            />
            <details>
              <summary>Show the numbers</summary>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Analysis</th><th>Gain (MPa)</th><th>95% interval</th><th>p-value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[["Plain", naive], ["CUPED", cuped]].map(([label, r]) => (
                      <tr key={label}>
                        <td>{label}</td>
                        <td>{fmt(r.effect)}</td>
                        <td>{fmt(r.ci_low)} to {fmt(r.ci_high)}</td>
                        <td>{r.p_value < 0.001 ? "<0.001" : fmt(r.p_value, 3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>

          {required && (
            <section className="section">
              <h2>Specimens needed</h2>
              <Bars
                first={{ label: "Plain", share: 1, text: `${required.naive} per group` }}
                second={{ label: "CUPED", share: required.cuped / required.naive, text: `${required.cuped}` }}
              />
              <p className="verdict">{pct(1 - required.cuped / required.naive)} fewer with CUPED</p>
            </section>
          )}

          {mc && (
            <section className="section">
              <h2>{result.true_effect === 0 ? "False alarms" : "Chance of spotting the gain"}</h2>
              <Bars
                first={{ label: "Plain", share: mc.naive.reject_rate, text: pct(mc.naive.reject_rate) }}
                second={{ label: "CUPED", share: mc.cuped.reject_rate, text: pct(mc.cuped.reject_rate) }}
              />
              <details>
                <summary>Show the numbers</summary>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Analysis</th><th>Average gain</th><th>Spread</th><th>Interval coverage</th><th>Interval width</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(mc).map(([method, m]) => (
                        <tr key={method}>
                          <td>{method === "cuped" ? "CUPED" : "Plain"}</td>
                          <td>{fmt(m.mean_effect)}</td>
                          <td>{fmt(m.sd_effect)}</td>
                          <td>{(m.ci_coverage * 100).toFixed(1)}%</td>
                          <td>{fmt(m.mean_ci_width)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </section>
          )}
        </>
      )}
    </div>
  );
}
