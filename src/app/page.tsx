import Link from "next/link";
import { JoinForm } from "@/components/join-form";

export default function Home() {
  return (
    <main>
      <h1>Join a station</h1>
      <JoinForm />
      <Link href="/operator">Operator: start a session</Link>
    </main>
  );
}
