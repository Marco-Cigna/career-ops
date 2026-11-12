import { BriefcaseBusiness, CalendarClock, CalendarDays, CircleX, Globe2, Hourglass, Inbox, MessageSquareReply, Send, Timer, Trophy, Users, Target } from "lucide-react";
import { ActivityChart } from "@/components/analytics/activity-chart";
import { GoalsEditor } from "@/components/analytics/goals-editor";
import { BarRow, BreakdownList, EmptyData, MetricCard, Panel } from "@/components/analytics-view";
import type { computeApplicationActivity } from "@/lib/application-activity.mjs";

type Activity = ReturnType<typeof computeApplicationActivity>;

const rate = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);
const days = (v: number | null) => (v === null ? "—" : `${Math.round(v)} d`);
const date = (iso: string | null) => {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};

// Applications actually sent: momentum, replies, where they stand, where they
// went in, and progress against goals the user sets here.
export function ApplicationActivityPanel({ activity }: { activity: Activity }) {
  if (!activity.total) {
    return (
      <div className="mt-6">
        <Panel eyebrow="Applications" title="Application activity">
          <EmptyData label="No applications sent yet" detail="Rows reach this view once their status is Applied or later." />
        </Panel>
      </div>
    );
  }
  return (
    <div className="mt-6 space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <MetricCard label="Total applications" value={activity.total} icon={<Send className="size-4" />} />
        <MetricCard label="Awaiting response" value={activity.awaiting} icon={<Hourglass className="size-4" />} />
        <MetricCard label="Responses" value={activity.responses} icon={<MessageSquareReply className="size-4" />} />
        <MetricCard label="Response rate" value={rate(activity.responseRate)} icon={<Inbox className="size-4" />} />
        <MetricCard label="Rejected" value={activity.rejected} icon={<CircleX className="size-4" />} />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MetricCard label="Last 30 days" value={activity.last30} icon={<CalendarClock className="size-4" />} />
        <MetricCard label="This month" value={activity.thisMonth} icon={<CalendarDays className="size-4" />} />
        <MetricCard label="Avg. response" value={days(activity.avgResponseDays)} icon={<Timer className="size-4" />} />
        <MetricCard label="Interviews" value={activity.interviews} icon={<Users className="size-4" />} />
        <MetricCard label="Offers" value={activity.offers} icon={<Trophy className="size-4" />} />
        <MetricCard label="Days tracking" value={activity.trackingDays} icon={<CalendarDays className="size-4" />} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.85fr)]">
        <Panel eyebrow="Activity" title="Application activity, rolling 12 months" description="Applications by the month they were sent; responses by the month the reply arrived.">
          <ActivityChart months={activity.months} />
        </Panel>
        <Panel eyebrow="Pipeline" title="Current application pipeline" description="Where every application you sent stands now.">
          <div className="mt-5 space-y-3">
            {activity.pipeline.map((stage) => (
              <BarRow key={stage.label} label={stage.label} count={stage.count} pct={stage.pct} widthPct={stage.pct} tone={stage.label === "Rejected" ? "bg-[var(--series-1)]" : "bg-[var(--series-2)]"} />
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-4">
        <Panel eyebrow="Channel" title="Applications by source">
          <BreakdownList rows={activity.sources} icon={<Globe2 className="size-3.5" />} emptyLabel="No posting links" />
        </Panel>
        <Panel eyebrow="Work mode" title="Work arrangement mix">
          <BreakdownList rows={activity.arrangements} icon={<BriefcaseBusiness className="size-3.5" />} emptyLabel="No work-mode data" />
        </Panel>
        <Panel eyebrow="Snapshot" title="Performance snapshot">
          <dl className="mt-3 divide-y divide-border text-sm">
            <Stat label="Applications last 7 days" value={activity.last7} />
            <Stat label="Most recent application" value={date(activity.lastApplied)} />
            <Stat label="Rejection rate" value={rate(activity.rejectionRate)} />
            <Stat label="Average pace / day" value={activity.perDay.toFixed(2)} />
            <Stat label="Applications with response" value={activity.responses} />
            <Stat label="Median response time" value={activity.responseSamples ? days(activity.medianResponseDays) : "—"} />
          </dl>
        </Panel>
        <Panel eyebrow="Targets" title="Goals" icon={<Target className="size-4" />}>
          <GoalsEditor year={activity.goals.year} rolling30={activity.goals.rolling30} />
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
