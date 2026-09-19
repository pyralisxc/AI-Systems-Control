import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "AI Systems Control",
    template: "%s | AI Systems Control"
  },
  description:
    "Owner-facing control plane for project reality, specialist capabilities, drift, and governed development actions."
};

export default function RootLayout({
  children
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
