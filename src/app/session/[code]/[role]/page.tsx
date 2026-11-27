import { Suspense } from "react";
import { NotJoined, StationView } from "@/components/station-view";
import { isStationRole } from "@/lib/protocol/device";

export default function StationPage({ params }: PageProps<"/session/[code]/[role]">) {
  return (
    <Suspense>
      {params.then(({ code, role }) =>
        isStationRole(role) ? <StationView key={`${code}/${role}`} code={code} role={role} /> : <NotJoined />,
      )}
    </Suspense>
  );
}
