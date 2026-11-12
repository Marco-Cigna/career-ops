"use client";

import { useState } from "react";

type Month = { key: string; label: string; applied: number; responses: number };

const HEIGHT = 200;
const PAD_TOP = 22;
const PAD_BOTTOM = 26;
const PAD_LEFT = 28;
const BAR_W = 11;
const GAP = 2; // surface gap between a month's two bars

// Applications and responses per month, as grouped bars on one count axis.
// Hover (or focus) a month for its exact figures; the table below carries the
// same numbers for screen readers and for anyone who prefers to read them.
export function ActivityChart({ months }: { months: Month[] }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...months.map((m) => Math.max(m.applied, m.responses)));
  const top = niceMax(max);
  const width = 640;
  const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const slot = (width - PAD_LEFT) / months.length;
  const y = (v: number) => PAD_TOP + plotH - (v / top) * plotH;
  const peak = months.reduce((best, m, i) => (m.applied > (months[best]?.applied ?? -1) ? i : best), 0);
  const ticks = [0, top / 2, top].filter((t, i, a) => a.indexOf(t) === i);
  const shown = active ?? null;

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: "var(--series-1)" }} />Applications</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: "var(--series-2)" }} />Responses</span>
      </div>
      <div className="relative mt-2">
        <svg viewBox={`0 0 ${width} ${HEIGHT}`} className="h-auto w-full" role="img" aria-label="Applications and responses per month, last 12 months. Exact figures are in the table below.">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD_LEFT} x2={width} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
              <text x={PAD_LEFT - 6} y={y(t) + 3} textAnchor="end" className="fill-[var(--faint)] text-[10px] tabular-nums">{t}</text>
            </g>
          ))}
          {months.map((m, i) => {
            const cx = PAD_LEFT + slot * i + slot / 2;
            const x1 = cx - BAR_W - GAP / 2;
            const x2 = cx + GAP / 2;
            return (
              <g key={m.key}>
                {m.applied > 0 && <Bar x={x1} y={y(m.applied)} h={y(0) - y(m.applied)} fill="var(--series-1)" dim={shown !== null && shown !== i} />}
                {m.responses > 0 && <Bar x={x2} y={y(m.responses)} h={y(0) - y(m.responses)} fill="var(--series-2)" dim={shown !== null && shown !== i} />}
                {i === peak && m.applied > 0 && (
                  <text x={x1 + BAR_W / 2} y={y(m.applied) - 5} textAnchor="middle" className="fill-[var(--fg)] text-[10px] font-semibold tabular-nums">{m.applied}</text>
                )}
                <text x={cx} y={HEIGHT - 8} textAnchor="middle" className="fill-[var(--muted)] text-[10px]">{m.label.split(" ")[0]}</text>
                {/* Hit target: the whole month column, wider than either bar. */}
                <rect
                  x={PAD_LEFT + slot * i}
                  y={PAD_TOP}
                  width={slot}
                  height={plotH}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${m.label}: ${m.applied} applications, ${m.responses} responses`}
                  onMouseEnter={() => setActive(i)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  className="cursor-default outline-none focus-visible:stroke-[var(--color-brand)]"
                />
              </g>
            );
          })}
          <line x1={PAD_LEFT} x2={width} y1={y(0)} y2={y(0)} stroke="var(--muted)" strokeWidth={1} />
        </svg>
        {shown !== null && (
          <div
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg"
            style={{ left: `${((PAD_LEFT + slot * shown + slot / 2) / width) * 100}%` }}
            role="status"
          >
            <p className="font-semibold text-foreground">{months[shown].label}</p>
            <p className="mt-1 flex items-center gap-1.5 text-muted"><span className="size-2 rounded-sm" style={{ background: "var(--series-1)" }} />Applications <span className="ml-auto pl-3 font-mono tabular-nums text-foreground">{months[shown].applied}</span></p>
            <p className="flex items-center gap-1.5 text-muted"><span className="size-2 rounded-sm" style={{ background: "var(--series-2)" }} />Responses <span className="ml-auto pl-3 font-mono tabular-nums text-foreground">{months[shown].responses}</span></p>
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

// A data-end rounded 4px at the top, square on the baseline.
function Bar({ x, y, h, fill, dim }: { x: number; y: number; h: number; fill: string; dim: boolean }) {
  const r = Math.min(4, h, BAR_W / 2);
  const d = `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + BAR_W - r} Q${x + BAR_W},${y} ${x + BAR_W},${y + r} V${y + h} Z`;
  return <path d={d} fill={fill} opacity={dim ? 0.35 : 1} className="transition-opacity duration-150" />;
}

function niceMax(v: number): number {
  if (v <= 4) return 4;
  if (v <= 10) return 10;
  const step = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / step) * step;
}
