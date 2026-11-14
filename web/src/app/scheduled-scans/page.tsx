import { ScheduledJobsView } from "@/components/scheduled-jobs-view";
import { seedExploreFilters } from "@/lib/core/portals";
import { DEFAULT_FILTERS, type ExploreFilters } from "@/lib/explore";

export const dynamic = "force-dynamic";

export default function ScheduledScansPage() {
  // A new scheduled scan starts from the user's own filters, as Explore does. It
  // matters more here: a scan's filters REPLACE portals.yml's when it runs, so a
  // blank form would drop the user's title exclusions and location rules.
  let seed: { filters: ExploreFilters; seededFrom: string[] } = { filters: DEFAULT_FILTERS, seededFrom: [] };
  try {
    seed = seedExploreFilters();
  } catch {
    /* bare checkout → defaults */
  }
  return <ScheduledJobsView seed={seed} />;
}
