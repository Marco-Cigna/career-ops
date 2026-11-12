"use client";

import { useState } from "react";

type Month = { key: string; label: string; applied: number; responses: number };
type Pt = { x: number; y: number };

const WIDTH = 640;
const HEIGHT = 220;
const PAD = { top: 18, right: 14, bottom: 28, left: 30 };

// Applications and responses per month as two smooth lines on one count axis.
// The curve is monotone: it never overshoots a month's real value or dips
// below zero between two months, which ordinary spline smoothing does.
// Hover or focus a month for its figures; the table carries the same numbers.
export function ActivityChart({ months }: { months: Month[] }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...months.map((m) => Math.max(m.applied, m.responses)));
  const top = niceMax(max);
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const step = months.length > 1 ? plotW / (months.length - 1) : 0;
  const x = (i: number) => PAD.left + step * i;
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const applied = months.map((m, i) => ({ x: x(i), y: y(m.applied) }));
  const responses = months.map((m, i) => ({ x: x(i), y: y(m.responses) }));
  const ticks = [0, top / 4, top / 2, (top * 3) / 4, top].filter((t) => Number.isInteger(t));
  const peak = months.reduce((best, m, i) => (m.applied > months[best].applied ? i : best), 0);
  const hit = (i: number) => ({ x: i === 0 ? PAD.left : x(i) - step / 2, w: i === 0 || i === months.length - 1 ? step / 2 : step });

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted" aria-hidden="true">
        <Key color="var(--series-2)" label="Applications" />
        <Key color="var(--series-1)" label="Responses" />
      </div>
      <div className="relative mt-2">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto w-full overflow-visible" role="img" aria-label="Applications and responses per month, last 12 months. Exact figures are in the table below.">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} strokeDasharray={t === 0 ? undefined : "3 4"} />
              <text x={PAD.left - 8} y={y(t) + 3} textAnchor="end" className="fill-[var(--faint)] text-[10px] tabular-nums">{t}</text>
            </g>
          ))}
          <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(0)} y2={y(0)} stroke="var(--muted)" strokeWidth={1} />
          {months.map((m, i) => (
            <text key={m.key} x={x(i)} y={HEIGHT - 8} textAnchor="middle" className="fill-[var(--muted)] text-[10px]">{m.label}</text>
          ))}

          <path d={smoothPath(responses)} fill="none" stroke="var(--series-1)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
          <path d={smoothPath(applied)} fill="none" stroke="var(--series-2)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />

          {active === null && months[peak].applied > 0 && (
            <text x={applied[peak].x} y={applied[peak].y - 8} textAnchor="middle" className="fill-[var(--fg)] text-[10px] font-semibold tabular-nums">{months[peak].applied}</text>
          )}

          {active !== null && (
            <g pointerEvents="none">
              <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={y(0)} stroke="var(--muted)" strokeWidth={1} strokeDasharray="2 3" />
              <circle cx={responses[active].x} cy={responses[active].y} r={4.5} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />
              <circle cx={applied[active].x} cy={applied[active].y} r={4.5} fill="var(--series-2)" stroke="var(--surface)" strokeWidth={2} />
            </g>
          )}

          {months.map((m, i) => {
            const h = hit(i);
            return (
              <rect
                key={m.key}
                x={h.x}
                y={PAD.top}
                width={h.w}
                height={plotH}
                fill="transparent"
                tabIndex={0}
                aria-label={`${m.label}: ${m.applied} applications, ${m.responses} responses`}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                className="cursor-crosshair outline-none"
              />
            );
          })}
        </svg>
        {active !== null && (
          <div
            className="pointer-events-none absolute top-0 z-10 rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg"
            style={{
              left: `${(x(active) / WIDTH) * 100}%`,
              transform: `translateX(${active > months.length / 2 ? "calc(-100% - 12px)" : "12px"})`,
            }}
            role="status"
          >
            <p className="font-semibold text-foreground">{months[active].label}</p>
            <Row color="var(--series-2)" label="Applications" value={months[active].applied} />
            <Row color="var(--series-1)" label="Responses" value={months[active].responses} />
          </div>
        )}
      </div>
      <details className="mt-2 text-xs text-muted">
        <summary className="cursor-pointer select-none">Show as table</summary>
        <table className="mt-2 w-full max-w-sm text-left tabular-nums">
          <thead><tr className="text-faint"><th className="py-1 font-normal">Month</th><th className="py-1 text-right font-normal">Applications</th><th className="py-1 text-right font-normal">Responses</th></tr></thead>
          <tbody>{months.map((m) => <tr key={m.key} className="border-t border-border"><td className="py-1">{m.label}</td><td className="py-1 text-right text-foreground">{m.applied}</td><td className="py-1 text-right text-foreground">{m.responses}</td></tr>)}</tbody>
        </table>
      </details>
    </div>
  );
}

function Key({ color, label }: { color: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><span className="h-[3px] w-4 rounded-full" style={{ background: color }} />{label}</span>;
}

function Row({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <p className="mt-1 flex items-center gap-1.5 text-muted">
      <span className="h-[3px] w-3 rounded-full" style={{ background: color }} />
      {label}
      <span className="ml-auto pl-4 font-mono tabular-nums text-foreground">{value}</span>
    </p>
  );
}

/**
 * Monotone cubic (Fritsch–Carlson) through the points, as an SVG path. The
 * tangents are limited so each segment stays between its two end values: a
 * month with no applications stays on the baseline instead of curving below it.
 */
export function smoothPath(pts: Pt[]): string {
  if (!pts.length) return "";
  if (pts.length === 1) return `M${pts[0].x},${pts[0].y}`;
  const n = pts.length;
  const dx = pts.slice(1).map((p, i) => p.x - pts[i].x);
  const slope = pts.slice(1).map((p, i) => (p.y - pts[i].y) / dx[i]);
  const tangent = pts.map((_, i) => {
    if (i === 0) return slope[0];
    if (i === n - 1) return slope[n - 2];
    const a = slope[i - 1];
    const b = slope[i];
    return a * b <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / a + (dx[i] + 2 * dx[i - 1]) / b);
  });
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${pts[i].x + h},${pts[i].y + tangent[i] * h} ${pts[i + 1].x - h},${pts[i + 1].y - tangent[i + 1] * h} ${pts[i + 1].x},${pts[i + 1].y}`;
  }
  return d;
}

// A top that divides into four whole-number gridlines.
function niceMax(v: number): number {
  if (v <= 4) return 4;
  if (v <= 40) return Math.ceil(v / 4) * 4;
  if (v <= 200) return Math.ceil(v / 20) * 20;
  return Math.ceil(v / 200) * 200;
}
