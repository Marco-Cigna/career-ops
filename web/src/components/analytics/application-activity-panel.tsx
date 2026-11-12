import { BriefcaseBusiness, CalendarClock, Globe2, Hourglass, Inbox, Send, Timer, Target } from "lucide-react";
import { ActivityChart } from "@/components/analytics/activity-chart";
import { BarRow, BreakdownList, EmptyData, MetricCard, Panel } from "@/components/analytics-view";
import type { computeApplicationActivity } from "@/lib/application-activity.mjs";

type Activity = ReturnType<typeof computeApplicationActivity>;

const days = (v: number | null) => (v === null ? "—" : `${Math.round(v)} d`);
const date = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};

// Applications actually sent: volume over time, what came back and how fast,
// where they went in, and progress against the goals in config/profile.yml.
export function ApplicationActivityPanel({ activity }: { activity: Activity }) {
  if (!activity.total) {
    return (
      <div className="mt-6">
        <Panel eyebrow="Applications" title="Application activity">
          <EmptyData label="No applications sent yet" detail="Rows reach this view once their status is Applied or later. Imported trackers count too." />
        </Panel>
      </div>
    );
  }
  const { goals } = activity;
  return (
    <div className="mt-6 space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <MetricCard label="Applications" value={activity.total} icon={<Send className="size-4" />} />
        <MetricCard label="Awaiting reply" value={activity.awaiting} icon={<Hourglass className="size-4" />} />
        <MetricCard label="Response rate" value={activity.responseRate === null ? "—" : `${activity.responseRate.toFixed(0)}%`} icon={<Inbox className="size-4" />} />
        <MetricCard label="Avg. response" value={days(activity.avgResponseDays)} icon={<Timer className="size-4" />} />
        <MetricCard label="Last 30 days" value={activity.last30} icon={<CalendarClock className="size-4" />} />
        <MetricCard label="This month" value={activity.thisMonth} icon={<CalendarClock className="size-4" />} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.85fr)]">
        <Panel eyebrow="Activity" title="Applications and responses, last 12 months" description="Applications by the month they were sent; responses by the month the reply arrived.">
          <ActivityChart months={activity.months} />
        </Panel>
        <Panel eyebrow="Momentum" title="Pace and replies">
          <dl className="mt-4 divide-y divide-border text-sm">
            <Stat label="Sent in the last 7 days" value={activity.last7} />
            <Stat label="Average per week" value={activity.perWeek.toFixed(1)} />
            <Stat label="Most recent application" value={date(activity.lastApplied)} />
            <Stat label="Tracking since" value={`${date(activity.firstApplied)} (${activity.trackingDays} d)`} />
            <Stat label="Replies received" value={`${activity.responses} of ${activity.total}`} />
            <Stat label="Median response time" value={activity.responseSamples ? `${days(activity.medianResponseDays)} (${activity.responseSamples} dated)` : "—"} />
            <Stat label="Rejected · interviews · offers" value={`${activity.rejected} · ${activity.interviews} · ${activity.offers}`} />
          </dl>
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel eyebrow="Channel" title="Where you applied">
          <BreakdownList rows={activity.sources} icon={<Globe2 className="size-3.5" />} emptyLabel="No posting links" />
        </Panel>
        <Panel eyebrow="Work mode" title="Arrangement of roles applied to">
          <BreakdownList rows={activity.arrangements} icon={<BriefcaseBusiness className="size-3.5" />} emptyLabel="No work-mode data" />
        </Panel>
        <Panel eyebrow="Targets" title="Goals" icon={<Target className="size-4" />}>
          {goals.year || goals.rolling30 ? (
            <div className="mt-5 space-y-4">
              {goals.year && <BarRow label={`This year (goal ${goals.year.target})`} count={goals.year.count} pct={goals.year.pct} widthPct={goals.year.pct} tone="bg-brand" />}
              {goals.rolling30 && <BarRow label={`Last 30 days (goal ${goals.rolling30.target})`} count={goals.rolling30.count} pct={goals.rolling30.pct} widthPct={goals.rolling30.pct} tone="bg-brand" />}
            </div>
          ) : (
            <EmptyData label="No goals set" detail="Add goals.applications_per_year and goals.applications_per_30_days to config/profile.yml (Profile page, Settings tab)." />
          )}
        </Panel>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-mono text-sm tabular-nums text-foreground">{value}</dd>
    </div>
  );
}
