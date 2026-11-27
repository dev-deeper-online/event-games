import { presentDeviceIds, publishChanged } from "@/lib/ably";
import { maxNameLength } from "@/lib/protocol";
import { startMatch } from "@/lib/quiz";
import { authenticate, playerDevices } from "@/lib/sessions";

const playerName = (value: unknown) => {
  const name = typeof value === "string" ? value.trim() : "";
  return name && name.length <= maxNameLength ? name : null;
};

export async function POST(request: Request) {
  const device = await authenticate(request);
  if (!device) return Response.json({ error: "Unknown device." }, { status: 401 });
  if (device.role !== "operator") return Response.json({ error: "Only the operator can start a match." }, { status: 403 });

  const body = await request.json().catch(() => null);
  const player1 = playerName(body?.player1);
  const player2 = playerName(body?.player2);
  if (!player1 || !player2) {
    return Response.json({ error: `Enter both names, up to ${maxNameLength} characters each.` }, { status: 400 });
  }

  const [players, present] = await Promise.all([playerDevices(device), presentDeviceIds(device.code)]);
  if (!players.every((id) => id && present.has(id))) {
    return Response.json({ error: "Both player devices must be connected." }, { status: 409 });
  }

  const refusal = await startMatch(device, { player1, player2 }, Date.now());
  if (refusal) return Response.json({ error: refusal.error }, { status: refusal.status });

  await publishChanged(device.code);
  return Response.json({}, { status: 201 });
}
