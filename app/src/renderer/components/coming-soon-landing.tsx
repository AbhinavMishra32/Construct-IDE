import { motion } from "framer-motion";
import { SparklesIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

const backdropOrbs = [
  {
    animate: {
      scale: [1, 1.08, 0.96, 1],
      x: [0, 28, -14, 0],
      y: [0, 18, -12, 0]
    },
    className: "construct-coming-soon-orb construct-coming-soon-orb--north",
    duration: 18
  },
  {
    animate: {
      scale: [1, 0.94, 1.06, 1],
      x: [0, -22, 18, 0],
      y: [0, 26, -16, 0]
    },
    className: "construct-coming-soon-orb construct-coming-soon-orb--east",
    duration: 22
  },
  {
    animate: {
      scale: [1, 1.05, 0.97, 1],
      x: [0, 18, -24, 0],
      y: [0, -20, 14, 0]
    },
    className: "construct-coming-soon-orb construct-coming-soon-orb--south",
    duration: 20
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
          <motion.span
            key={orb.className}
            className={orb.className}
            animate={orb.animate}
            transition={{
              duration: orb.duration,
              ease: "easeInOut",
              repeat: Number.POSITIVE_INFINITY
            }}
          />
        ))}
      </div>
      <div className="construct-coming-soon-grid" aria-hidden="true" />
      <div className="construct-coming-soon-shell">
        <header className="construct-coming-soon-toolbar">
          <Badge variant="outline" className="construct-coming-soon-brand">
            <SparklesIcon data-icon="inline-start" />
            Construct
          </Badge>
          {themeControl}
        </header>
        <div className="construct-coming-soon-stage">
          <motion.div
            className="construct-coming-soon-card-wrap"
            initial={{ opacity: 0, scale: 0.985, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          >
            <Card className="construct-coming-soon-card gap-0 bg-transparent py-0 ring-0">
              <CardContent className="construct-coming-soon-card-content px-0">
                <Badge variant="outline" className="construct-coming-soon-kicker">
                  Soon
                </Badge>
                <h1 className="construct-coming-soon-title">Coming soon.</h1>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
    </main>
  );
}
