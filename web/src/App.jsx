import { useEffect, useState } from "react";
import { getHealth } from "./api";
import PredictionPanel from "./components/PredictionPanel";
import AnalyticsPanel from "./components/AnalyticsPanel";
import ExperimentPanel from "./components/ExperimentPanel";
import IntroScene from "./components/IntroScene";

const prefersReducedMotion =
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const TABS = [
  { id: "predict", title: "Predict", Panel: PredictionPanel },
  { id: "analyse", title: "Analyse", Panel: AnalyticsPanel },
  { id: "experiment", title: "Experiment", Panel: ExperimentPanel },
];

export default function App() {
  const [tab, setTab] = useState("predict");
  const [health, setHealth] = useState(null);
  const [intro, setIntro] = useState(!prefersReducedMotion); // 3D intro, shown on every load
  const [revealing, setRevealing] = useState(false);

  // Fetched quietly: the model's typical error draws the shaded band on the strength ruler.
  useEffect(() => {
    getHealth().then(setHealth).catch(() => {});
  }, []);

  const Active = TABS.find((t) => t.id === tab).Panel;

  return (
    <>
    <div className={"frame" + (revealing ? " reveal" : "")}>
      <header className="topbar">
        <div className="topbar-inner">
          <span className="brand">StructIQ</span>
          <nav className="rail" aria-label="Sections">
            {TABS.map(({ id, title }) => (
              <button key={id} aria-current={id === tab ? "page" : undefined} onClick={() => setTab(id)}>
                {title}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="sheet">
        <Active health={health} />
      </main>
    </div>
    {intro && <IntroScene onLeaveStart={() => setRevealing(true)} onDone={() => setIntro(false)} />}
    </>
  );
}
