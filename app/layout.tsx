import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dayframe — your work and study space",
  description: "A quiet, personal workspace for today's tasks, projects, and focused time.",
  applicationName: "Dayframe",
  appleWebApp: { capable: true, title: "Dayframe", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#10151b",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
