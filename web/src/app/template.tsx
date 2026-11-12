// Re-mounts on every navigation (unlike layout.tsx), so each page's blocks get
// the top-down entrance in globals.css (.page-enter). Purely presentational: no
// state, no data, and nothing renders differently with motion turned off.
export default function PageTemplate({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
