import { Suspense } from "react";
import { NotJoined, StationView } from "@/components/station-view";
import { isRole } from "@/lib/protocol/roles";

export default function StationPage({ params }: PageProps<"/session/[code]/[role]">) {
  return (
    <Suspense>
      {params.then(({ code, role }) =>
        isRole(role) ? <StationView key={`${code}/${role}`} code={code} role={role} /> : <NotJoined />,
      )}
    </Suspense>
  );
}
