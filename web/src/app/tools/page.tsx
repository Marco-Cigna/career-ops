import { Wrench } from "lucide-react";
import { ToolsView } from "@/components/tools-view";

export const dynamic = "force-dynamic";

export default function ToolsPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="flex items-center gap-3">
        <Wrench className="size-6 text-brand-text" />
        <h1 className="font-display text-2xl tracking-tight text-landing">Tools</h1>
      </div>
      <p className="mt-1.5 max-w-xl text-sm text-muted">
        The rest of career-ops, without a terminal. Reports and checks are free and instant. Agent tools use your AI
        and only ever produce drafts for you to review.
      </p>
      <div className="mt-6">
        <ToolsView />
      </div>
    </div>
  );
}
