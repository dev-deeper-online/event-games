import Link from "next/link";
import { CodeForm } from "@/components/join-form";

export default function Home() {
  return (
    <main>
      <h1>Join a station</h1>
      <p>Scan the code on the display, or type its join code.</p>
      <CodeForm />
      <Link href="/new">Staff: start a session</Link>
    </main>
  );
}
