import type { MetadataRoute } from "next";

// Installed as an app (Edge / Chrome: "Install this site as an app"), the window
// gets the app's own name and icon and a title bar in the page colour instead of
// the browser's grey one. `window-controls-overlay` goes one step further where
// the user turns it on (the chevron in the title bar): the title bar is removed
// and the page draws to the top edge of the window, with only the minimise /
// maximise / close buttons left floating. The layout for that lives in
// globals.css under "Installed-app title bar".
//
// theme_color here is the dark default; the <meta name="theme-color"> that
// layout.tsx and the theme toggle keep in sync overrides it while a page is open.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "career-ops",
    short_name: "career-ops",
    description: "The official, local-first web experience for career-ops.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["window-controls-overlay"],
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
