import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Operations Command Center",
  description:
    "Agentic operations dashboard: OpenClaw reasoning, n8n deterministic execution, GoHighLevel CRM actions, Supabase audit log.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
