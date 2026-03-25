import type { ReactNode } from "react";

const backdropOrbs = [
  {
    className: "construct-coming-soon-orb construct-coming-soon-orb--north",
  },
  {
    className: "construct-coming-soon-orb construct-coming-soon-orb--east",
  },
  {
    className: "construct-coming-soon-orb construct-coming-soon-orb--south",
  }
];

export function ComingSoonLanding({
  themeControl
}: {
  themeControl: ReactNode;
}) {
  return (
    <main className="construct-app construct-coming-soon" aria-label="Coming soon">
      <div className="construct-coming-soon-backdrop" aria-hidden="true">
        {backdropOrbs.map((orb) => (
          <span key={orb.className} className={orb.className} />
        ))}
      </div>
      <div className="construct-coming-soon-grid" aria-hidden="true" />
      <div className="construct-coming-soon-shell">
        <header className="construct-coming-soon-toolbar">{themeControl}</header>
        <div className="construct-coming-soon-stage">
          <div className="construct-coming-soon-copy">
            <h1 className="construct-coming-soon-title">Coming soon.</h1>
          </div>
        </div>
      </div>
    </main>
  );
}
