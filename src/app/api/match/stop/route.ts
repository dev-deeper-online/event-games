import { publishChanged } from "@/lib/ably";
import { stopMatch } from "@/lib/quiz";
import { authenticate } from "@/lib/sessions";

export async function POST(request: Request) {
  const device = await authenticate(request);
  if (!device) return Response.json({ error: "Unknown device." }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (typeof body?.matchId !== "string") {
    return Response.json({ error: "Send the match to stop." }, { status: 400 });
  }

  const refusal = await stopMatch(device, body.matchId, Date.now());
  if (refusal) return Response.json({ error: refusal.error }, { status: refusal.status });

  await publishChanged(device.code);
  return Response.json({});
}
