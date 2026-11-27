import { publishChanged } from "@/lib/ably";
import { stopMatch } from "@/lib/quiz";
import { asDevice, refuse } from "@/lib/route";

export const POST = (request: Request) => asDevice(request, async (device) => {
  const body = await request.json().catch(() => null);
  if (typeof body?.matchId !== "string") {
    return refuse({ error: "Send the match to stop.", status: 400 });
  }

  const refusal = await stopMatch(device, body.matchId, Date.now());
  if (refusal) return refuse(refusal);

  await publishChanged(device.code);
  return Response.json({});
});
