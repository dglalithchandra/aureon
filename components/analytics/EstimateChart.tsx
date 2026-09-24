import type { ErrorTrendPoint, ProjectComparison } from "@/lib/calibration/factors";

/**
 * Estimate against actual, as a chart with no charting library: two bars
 * per project, and a line of average error per month. An SVG the server
 * renders is smaller than any dependency that would draw the same thing,
 * and it prints and exports with the rest of the page.
 */

const WIDTH = 720;
const ROW_HEIGHT = 34;
const LABEL_WIDTH = 190;
const BAR_HEIGHT = 10;

export function EstimateVsActualChart({
  comparisons,
  titles,
}: {
  comparisons: readonly ProjectComparison[];
  /** Project id → title, so the chart can name the rows. */
  titles: Record<string, string>;
}): React.ReactElement {
  const height = Math.max(60, comparisons.length * ROW_HEIGHT + 30);
  const max = Math.max(
    1,
    ...comparisons.map((c) => Math.max(c.estimatedSprints, c.actualSprints)),
  );
  const scale = (value: number): number => ((WIDTH - LABEL_WIDTH - 60) * value) / max;

  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="text-blueprint-muted text-xs">
        Sprints estimated (line) against sprints taken (fill), per recorded project,
        oldest first.
      </figcaption>
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        role="img"
        aria-label="Estimated against actual sprints for each recorded project"
        className="w-full"
      >
        {comparisons.map((c, i) => {
          const y = i * ROW_HEIGHT + 16;
          const over = c.ratio > 1;
          return (
            <g key={c.projectId}>
              <text
                x={0}
                y={y + BAR_HEIGHT}
                className="fill-[var(--color-blueprint-muted)]"
                style={{ fontSize: 11 }}
              >
                {(titles[c.projectId] ?? "Project").slice(0, 28)}
              </text>
              {/* Estimated: the outline. */}
              <rect
                x={LABEL_WIDTH}
                y={y}
                width={Math.max(2, scale(c.estimatedSprints))}
                height={BAR_HEIGHT}
                rx={3}
                fill="none"
                stroke="var(--color-blueprint-line)"
                strokeWidth={1.5}
              />
              {/* Actual: the fill, amber when it ran over. */}
              <rect
                x={LABEL_WIDTH}
                y={y + BAR_HEIGHT + 3}
                width={Math.max(2, scale(c.actualSprints))}
                height={BAR_HEIGHT}
                rx={3}
                fill={over ? "#fbbf24" : "#34d399"}
                opacity={0.85}
              />
              <text
                x={WIDTH - 52}
                y={y + BAR_HEIGHT + 6}
                className="fill-[var(--color-blueprint-muted)]"
                style={{ fontSize: 11 }}
              >
                {c.actualSprints} / {c.estimatedSprints}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

export function ErrorTrendChart({
  points,
}: {
  points: readonly ErrorTrendPoint[];
}): React.ReactElement {
  const height = 160;
  const width = WIDTH;
  const max = Math.max(20, ...points.map((p) => p.averageErrorPercent));
  const step = points.length > 1 ? (width - 80) / (points.length - 1) : 0;
  const x = (i: number): number => 50 + i * step;
  const y = (value: number): number => height - 30 - ((height - 60) * value) / max;

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.averageErrorPercent)}`)
    .join(" ");

  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="text-blueprint-muted text-xs">
        Average absolute error by the month a project was recorded. Down is better.
      </figcaption>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Average estimate error over time"
        className="w-full"
      >
        <line
          x1={50}
          y1={y(0)}
          x2={width - 30}
          y2={y(0)}
          stroke="var(--color-blueprint-line)"
          strokeWidth={1}
        />
        <text
          x={0}
          y={y(max) + 4}
          className="fill-[var(--color-blueprint-muted)]"
          style={{ fontSize: 11 }}
        >
          {max}%
        </text>
        <text
          x={0}
          y={y(0) + 4}
          className="fill-[var(--color-blueprint-muted)]"
          style={{ fontSize: 11 }}
        >
          0%
        </text>
        {points.length > 1 && (
          <path
            d={path}
            fill="none"
            stroke="var(--color-blueprint-accent)"
            strokeWidth={2}
          />
        )}
        {points.map((p, i) => (
          <g key={p.month}>
            <circle
              cx={x(i)}
              cy={y(p.averageErrorPercent)}
              r={3.5}
              fill="var(--color-blueprint-accent)"
            />
            <text
              x={x(i)}
              y={height - 8}
              textAnchor="middle"
              className="fill-[var(--color-blueprint-muted)]"
              style={{ fontSize: 10 }}
            >
              {p.month}
            </text>
          </g>
        ))}
      </svg>
    </figure>
  );
}
