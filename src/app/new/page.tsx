import type { Metadata } from "next";
import Link from "next/link";
import { NewSession } from "@/components/new-session";

export const metadata: Metadata = { title: "New session - Event games" };

export default function New() {
  return (
    <main>
      <h1>Start a session</h1>
      <NewSession />
      <Link href="/">Join with a code</Link>
    </main>
  );
}
