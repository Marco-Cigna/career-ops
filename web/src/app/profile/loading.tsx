import { Skeleton } from "@/components/ui/skeleton";

export default function ProfileLoading() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-8" aria-label="Loading profile">
      <div className="flex items-center gap-3">
        <Skeleton className="size-6 rounded-full" />
        <Skeleton className="h-8 w-28" />
      </div>
      <Skeleton className="mt-3 h-4 w-full max-w-2xl" />
      <Skeleton className="mt-6 h-9 w-full rounded-full" />
      <Skeleton className="mt-4 h-[28rem] w-full rounded-xl" />
    </div>
  );
}
