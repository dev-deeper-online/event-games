import { publishChanged } from "@/lib/ably";
import { authenticate, markReady } from "@/lib/sessions";

export async function POST(request: Request) {
  const device = await authenticate(request);
  if (!device) return Response.json({ error: "Unknown device." }, { status: 401 });

  const refusal = await markReady(device, Date.now());
  if (refusal) return Response.json({ error: refusal.error }, { status: refusal.status });

  await publishChanged(device.code);
  return Response.json({}, { status: 201 });
}
