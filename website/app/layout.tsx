import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Construct - Project-based learning IDE",
  description:
    "Construct turns real software projects into executable learning tapes that guide implementation, test recall, and verify your code.",
  metadataBase: new URL("https://tryconstruct.cc"),
  alternates: {
    canonical: "/"
  },
  openGraph: {
    title: "Construct",
    description: "Build real software, learn with intent.",
    url: "https://tryconstruct.cc",
    siteName: "Construct",
    type: "website"
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
