import { Suspense } from "react";
import { JoinForm } from "@/components/join-form";

export default function JoinPage({ params }: PageProps<"/join/[code]">) {
  return (
    <Suspense>
      <main>
        {params.then(({ code }) => (
          <JoinForm key={code} code={code} />
        ))}
      </main>
    </Suspense>
  );
}
