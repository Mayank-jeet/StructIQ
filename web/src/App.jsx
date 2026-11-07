import { useEffect, useState } from "react";
import { getHealth } from "./api";
import PredictionPanel from "./components/PredictionPanel";
import AnalyticsPanel from "./components/AnalyticsPanel";
import ExperimentPanel from "./components/ExperimentPanel";

const TABS = [
  { id: "predict", label: "Predict & explain", Panel: PredictionPanel },
  { id: "analytics", label: "SQL analytics", Panel: AnalyticsPanel },
  { id: "experiment", label: "A/B experiment", Panel: ExperimentPanel },
];

export default function App() {
  const [tab, setTab] = useState("predict");
  const [health, setHealth] = useState(null);
  const [offline, setOffline] = useState(false);

  // Ask the API who it is once; the badge tells the user at a glance whether the backend is up.
  useEffect(() => {
    getHealth().then(setHealth).catch(() => setOffline(true));
  }, []);

  const Active = TABS.find((t) => t.id === tab).Panel;

  return (
    <div className="app">
      <header>
        <div>
          <h1>StructIQ</h1>
          <p className="muted">Concrete strength prediction, SQL analytics and A/B experimentation</p>
        </div>
        {health && (
          <span className="badge ok">
            API online · {health.model} · test RMSE {health.test_metrics.rmse.toFixed(2)} MPa
          </span>
        )}
        {offline && <span className="badge bad">API not reachable</span>}
      </header>

      <nav>
        {TABS.map(({ id, label }) => (
          <button key={id} className={id === tab ? "tab active" : "tab"} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>

      <main>
        <Active />
      </main>
    </div>
  );
}
