import { Suspense } from "react";
import { StationView } from "@/components/station-view";

export default function StationPage({ params }: PageProps<"/session/[code]/[role]">) {
  return (
    <Suspense>
      {params.then(({ code, role }) => (
        <StationView key={`${code}/${role}`} code={code} role={role} />
      ))}
    </Suspense>
  );
}
