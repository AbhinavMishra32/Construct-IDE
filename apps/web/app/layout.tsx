import type { ReactNode } from "react";
import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Construct",
  description:
    "Construct is the desktop IDE for AI-guided software development: stable project spine, adaptive mentor, real code workspace, deep observability, and user-owned builds."
};

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
