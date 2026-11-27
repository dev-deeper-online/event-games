import { authenticate, snapshotFor } from "@/lib/sessions";

export async function GET(request: Request) {
  const device = await authenticate(request);
  if (!device) return Response.json({ error: "Unknown device." }, { status: 401 });

  return Response.json(await snapshotFor(device), { headers: { "cache-control": "no-store" } });
}
