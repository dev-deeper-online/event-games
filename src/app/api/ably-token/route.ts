import { tokenRequestFor } from "@/lib/ably";
import { authenticate } from "@/lib/sessions";

export async function GET(request: Request) {
  const device = await authenticate(request);
  if (!device) return Response.json({ error: "Unknown device." }, { status: 401 });

  return Response.json(await tokenRequestFor(device.code, device.deviceId), {
    headers: { "cache-control": "no-store" },
  });
}
