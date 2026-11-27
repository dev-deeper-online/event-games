import { publishChanged } from "@/lib/ably";
import { asDevice } from "@/lib/route";
import { liveSnapshotFor } from "@/lib/sessions";

const headers = { "cache-control": "no-store" };

const respond = (request: Request, checkIn: boolean) => asDevice(request, async (device) => {
  const { snapshot, stopped } = await liveSnapshotFor(device, Date.now(), { checkIn });
  if (stopped) await publishChanged(device.code);
  return Response.json(snapshot, { headers });
});

export const GET = (request: Request) => respond(request, false);
export const POST = (request: Request) => respond(request, true);
