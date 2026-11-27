import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Event games",
  description: "Live quiz and budget allocation games",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
