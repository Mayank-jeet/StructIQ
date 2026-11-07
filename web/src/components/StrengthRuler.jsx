// The signature element: a 0-90 MPa ruler divided at the Indian concrete grades (M20 ... M60).
// The marker shows the predicted strength; the pale band is the model's typical error.
const MAX = 90;
const GRADES = [20, 25, 30, 35, 40, 45, 50, 55, 60];

/** Highest grade whose strength level the value reaches, or null below M20. */
export function gradeFor(value) {
  return [...GRADES].reverse().find((g) => value >= g) ?? null;
}

export default function StrengthRuler({ value, error }) {
  const W = 640;
  const H = 122;
  const padX = 16;
  const barY = 54;
  const barH = 22;
  const x = (v) => padX + (Math.min(Math.max(v, 0), MAX) / MAX) * (W - 2 * padX);
  const edges = [0, ...GRADES, MAX]; // segment boundaries: below M20, M20-25, ..., above M60

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="ruler"
      role="img"
      aria-label={`Predicted strength ${value.toFixed(1)} MPa on a scale from 0 to ${MAX} MPa`}
    >
      {edges.slice(0, -1).map((edge, i) => (
        <rect
          key={edge}
          x={x(edge)}
          y={barY}
          width={x(edges[i + 1]) - x(edge)}
          height={barH}
          className={i % 2 ? "seg b" : "seg a"}
        />
      ))}
      {GRADES.map((g) => (
        <g key={g}>
          <line x1={x(g)} x2={x(g)} y1={barY - 4} y2={barY + barH} className="tick" />
          <text x={x(g)} y={barY + barH + 17} textAnchor="middle" className="tick-label">
            M{g}
          </text>
        </g>
      ))}
      {error > 0 && (
        <rect
          x={x(value - error)}
          y={barY - 10}
          width={x(value + error) - x(value - error)}
          height={barH + 20}
          className="band"
        />
      )}
      <line x1={x(value)} x2={x(value)} y1={barY - 16} y2={barY + barH + 6} className="marker-edge" />
      <line x1={x(value)} x2={x(value)} y1={barY - 16} y2={barY + barH + 6} className="marker" />
      <text x={x(value)} y={barY - 24} textAnchor="middle" className="marker-label">
        {value.toFixed(1)}
      </text>
      <text x={padX} y={H - 6} className="axis-note">0 MPa</text>
      <text x={W - padX} y={H - 6} textAnchor="end" className="axis-note">{MAX} MPa</text>
    </svg>
  );
}
