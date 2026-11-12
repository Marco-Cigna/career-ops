"use client";

import { useLayoutEffect, useRef } from "react";

// Every route's placeholder (loading.tsx, or a page's own Suspense fallback)
// labels itself "Loading …"; compare's uses role="status".
const PLACEHOLDER = '[aria-label^="Loading"], [role="status"]';

// How long a placeholder must have been on screen for its entrance to count.
// Shorter than this it was still mostly transparent, so the page gets the full
// entrance instead.
const PLACEHOLDER_SEEN_MS = 250;

// Re-mounts on every navigation (unlike layout.tsx), so each page gets the
// top-down entrance in globals.css (.page-enter) exactly once. A slow page
// shows its placeholder first, and the placeholder plays the entrance; when the
// real page then replaces it, data-enter="swap" turns the page's own entrance
// into a short fade. Without that the page built itself top-down twice: once as
// the placeholder, once as the content.
export default function PageTemplate({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let placeholderSince: number | null = null;
    // The callback runs as a microtask after React's DOM commit, before the
    // browser paints, so the attribute is in place for the content's first frame.
    const observer = new MutationObserver(() => check());
    const check = () => {
      const root = el.firstElementChild;
      if (!root) return;
      if (root.matches(PLACEHOLDER)) {
        placeholderSince ??= performance.now();
        return;
      }
      if (placeholderSince !== null && performance.now() - placeholderSince >= PLACEHOLDER_SEEN_MS) {
        el.dataset.enter = "swap";
      }
      observer.disconnect();
    };
    check();
    observer.observe(el, { childList: true });
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="page-enter">
      {children}
    </div>
  );
}
