import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Phollet AI Builder",
  description: "Build and preview React interfaces with an AI coding agent.",
  other: {
    google: "notranslate",
  },
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
