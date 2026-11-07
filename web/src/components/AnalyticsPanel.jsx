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
    title: "Strength by cement bucket",
    about: "More cement means stronger concrete on average. This is the trend the model has to learn.",
    chart: { kind: "bar", x: "cement_bucket", y: "avg_strength", unit: " MPa" },
  },
  error_by_strength_bin: {
    title: "Model error by true strength",
    about: "Bias = prediction minus truth. The strongest concrete is under-predicted: the model's weak spot.",
    chart: { kind: "bar", x: "strength_bin", y: "bias", unit: " MPa", signed: true },
  },
  wc_ratio_rolling_strength: {
    title: "Water/cement ratio vs 28-day strength",
    about: "Abrams' law: less water per cement gives stronger concrete. The line is a 10-specimen rolling average.",
    chart: { kind: "line", x: "wc_ratio", ys: ["strength_mpa", "rolling_avg_10"] },
  },
  strength_gain_by_recipe: {
    title: "Strength gain per recipe",
    about: "For recipes tested at several ages: gain since the previous test and since the first (window functions).",
  },
  worst_predictions_by_age: {
    title: "Worst predictions per age group",
    about: "The three largest misses in each age group (ROW_NUMBER over a partition).",
  },
};

const MAX_ROWS = 50;

function QueryChart({ chart, rows }) {
  if (chart.kind === "bar") {
    return (
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={rows}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey={chart.x} />
          <YAxis unit={chart.unit} />
          <Tooltip />
          {chart.signed && <ReferenceLine y={0} stroke="#888" />}
          <Bar dataKey={chart.y}>
            {rows.map((r, i) => (
              <Cell key={i} fill={chart.signed && r[chart.y] < 0 ? "#d1495b" : "#3b6fd4"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={rows}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey={chart.x} type="number" domain={["dataMin", "dataMax"]} />
        <YAxis unit=" MPa" />
        <Tooltip />
        <Legend />
        {/* individual specimens as dots only, the rolling average as a line only */}
        <Line dataKey={chart.ys[0]} stroke="#9aa5b8" strokeOpacity={0} dot={{ r: 2 }} isAnimationActive={false} />
        <Line dataKey={chart.ys[1]} stroke="#d1495b" dot={false} strokeWidth={2} isAnimationActive={false} />
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
    let cancelled = false; // ignore a slow response if the user already picked another query
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
    <div className="card">
      <h2>SQL analytics</h2>
      <label className="inline">
        <span>Analysis</span>
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          {names.map((n) => (
            <option key={n} value={n}>
              {VIEWS[n]?.title || n}
            </option>
          ))}
        </select>
      </label>
      {view.about && <p className="muted">{view.about}</p>}
      {error && <p className="error">{error}</p>}
      {!data && !error && <p className="muted">Loading…</p>}

      {data && (
        <>
          {view.chart && <QueryChart chart={view.chart} rows={data.rows} />}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {data.columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.slice(0, MAX_ROWS).map((row, i) => (
                  <tr key={i}>
                    {data.columns.map((c) => (
                      <td key={c}>{row[c] ?? "–"}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">
            {data.rows.length > MAX_ROWS ? `Showing the first ${MAX_ROWS} of ${data.rows.length} rows.` : `${data.rows.length} rows.`}
          </p>
        </>
      )}
    </div>
  );
}
