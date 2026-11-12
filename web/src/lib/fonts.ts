import localFont from "next/font/local";

// The whole interface uses Inter, as the Eutility dashboard does: body, headings,
// figures and labels. The latin variable subset is vendored so an offline
// production build never contacts Google. Code uses the system monospace face
// (--font-code in globals.css), so no second family is shipped.
export const inter = localFont({
  src: [{
    path: "../assets/fonts/inter/Inter-Latin-Variable.woff2",
    weight: "100 900",
    style: "normal",
  }],
  variable: "--font-inter",
  display: "swap",
});
