import { publishChanged } from "@/lib/ably";
import { authenticate, liveSnapshotFor } from "@/lib/sessions";

const headers = { "cache-control": "no-store" };

async function respond(request: Request, checkIn: boolean) {
  const device = await authenticate(request);
  if (!device) return Response.json({ error: "Unknown device." }, { status: 401 });

  const { snapshot, stopped } = await liveSnapshotFor(device, Date.now(), { checkIn });
  if (stopped) await publishChanged(device.code);
  return Response.json(snapshot, { headers });
}

export const GET = (request: Request) => respond(request, false);
export const POST = (request: Request) => respond(request, true);
