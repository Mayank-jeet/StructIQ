import { useEffect, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { getQueries, getQuery } from "../api";

// How to present each named SQL query. A query with no `chart` is shown as a table only,
// and a query missing from this map still works (generic table), so adding SQL never breaks the UI.
const VIEWS = {
  strength_by_cement_bucket: {
    title: "Strength by cement",
    about: "More cement, stronger concrete.",
    chart: { kind: "bar", x: "cement_bucket", y: "avg_strength", unit: " MPa" },
  },
  error_by_strength_bin: {
    title: "Model errors",
    chart: { kind: "bar", x: "strength_bin", y: "bias", unit: " MPa", signed: true },
  },
  wc_ratio_rolling_strength: {
    title: "Water/cement ratio",
    about: "Less water, stronger concrete.",
    chart: { kind: "line", x: "wc_ratio", ys: ["strength_mpa", "rolling_avg_10"] },
  },
  strength_gain_by_recipe: {
    title: "Strength gain",
    about: "Strength gained by each recipe between tests.",
  },
  worst_predictions_by_age: {
    title: "Biggest misses",
    about: "Three largest errors per age group.",
  },
  experiment_pool: {
    title: "Experiment pool",
    about: "Specimens and predictions used in Experiment.",
  },
};

const MAX_ROWS = 50;
const head = (c) => { const s = c.replace(/_/g, " "); return s.charAt(0).toUpperCase() + s.slice(1); }; // strength_bin -> Strength bin
const AXIS = { fill: "var(--muted)", fontSize: 13 };
const TOOLTIP = { background: "var(--sheet)", border: "1px solid var(--rule)", color: "var(--ink)" };

function QueryChart({ chart, rows }) {
  if (chart.kind === "bar") {
    return (
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={rows}>
          <CartesianGrid stroke="var(--rule)" strokeOpacity={0.6} vertical={false} />
          <XAxis dataKey={chart.x} tick={AXIS} stroke="var(--rule)" />
          <YAxis unit={chart.unit} tick={AXIS} stroke="var(--rule)" />
          <Tooltip contentStyle={TOOLTIP} cursor={{ fill: "var(--survey-soft)" }} />
          {chart.signed && <ReferenceLine y={0} stroke="var(--muted)" />}
          <Bar dataKey={chart.y} name={head(chart.y)}>
            {rows.map((r, i) => (
              <Cell
                key={i}
                fill={chart.signed ? (r[chart.y] < 0 ? "var(--negative)" : "var(--positive)") : "var(--steel)"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={rows}>
        <CartesianGrid stroke="var(--rule)" strokeOpacity={0.6} />
        <XAxis dataKey={chart.x} type="number" domain={["dataMin", "dataMax"]} tick={AXIS} stroke="var(--rule)" />
        <YAxis unit=" MPa" tick={AXIS} stroke="var(--rule)" />
        <Tooltip contentStyle={TOOLTIP} />
        <Legend />
        {/* individual specimens as dots only, the rolling average as a line only */}
        <Line dataKey={chart.ys[0]} name="specimen" stroke="var(--muted)" strokeOpacity={0} dot={{ r: 2.5, fill: "var(--muted)" }} isAnimationActive={false} />
        <Line dataKey={chart.ys[1]} name="rolling average" stroke="var(--negative)" dot={false} strokeWidth={2.5} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export default function AnalyticsPanel() {
  const [names, setNames] = useState([]);
  const [selected, setSelected] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getQueries()
      .then((r) => {
        setNames(r.queries);
        setSelected(r.queries.includes("error_by_strength_bin") ? "error_by_strength_bin" : r.queries[0]);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false; // ignore a slow response if the user already picked another view
    setData(null);
    setError("");
    getQuery(selected)
      .then((r) => !cancelled && setData(r))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const view = VIEWS[selected] || {};

  return (
    <div className="analyse">
      <div className="views" role="list">
        {names.map((n) => (
          <button key={n} aria-current={n === selected} onClick={() => setSelected(n)}>
            {VIEWS[n]?.title || n}
          </button>
        ))}
      </div>

      <div>
        <h2>{view.title || selected}</h2>
        {view.about && <p className="muted">{view.about}</p>}
        {error && <p className="error">{error}</p>}
        {!data && !error && <p className="muted">Loading…</p>}

        {data && (() => {
          const table = (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {data.columns.map((c) => (
                      <th key={c}>{head(c)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.slice(0, MAX_ROWS).map((row, i) => (
                    <tr key={i}>
                      {data.columns.map((c) => (
                        <td key={c}>{row[c] ?? "n/a"}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
          // charts lead; the raw table is tucked away. Views without a chart show the table directly.
          return view.chart ? (
            <>
              <QueryChart chart={view.chart} rows={data.rows} />
              <details>
                <summary>Show the data</summary>
                {table}
              </details>
            </>
          ) : (
            table
          );
        })()}
      </div>
    </div>
  );
}
