import { UserRound } from "lucide-react";
import Link from "next/link";
import { ProfileEditor } from "@/components/profile-editor";

export const dynamic = "force-dynamic";

export default function ProfilePage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="flex items-center gap-3">
        <UserRound className="size-6 text-brand-text" />
        <h1 className="font-display text-2xl tracking-tight text-landing">Profile</h1>
      </div>
      <p className="mt-1.5 max-w-2xl text-sm text-muted">
        Everything career-ops knows about you and how you want it to work. These are your own files on this computer:
        updates never change them and they are not part of the code. Your CV itself is on the{" "}
        <Link href="/cv" className="text-brand-text underline-offset-2 hover:underline">CV page</Link>.
      </p>
      <div className="mt-6">
        <ProfileEditor />
      </div>
    </div>
  );
}
