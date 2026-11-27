import { presentDeviceIds, publishChanged } from "@/lib/ably";
import { maxNameLength, parsePlayerName } from "@/lib/protocol/roles";
import { startMatch } from "@/lib/quiz";
import { asDevice, refuse } from "@/lib/route";
import { playerDevices } from "@/lib/sessions";

export const POST = (request: Request) => asDevice(request, async (device) => {
  // Checked here, so that anyone else learns nothing about the names or the player devices.
  if (device.role !== "operator") return refuse({ error: "Only the operator can start a match.", status: 403 });

  const body = await request.json().catch(() => null);
  const player1 = parsePlayerName(body?.player1);
  const player2 = parsePlayerName(body?.player2);
  if (!player1 || !player2) {
    return refuse({ error: `Enter both names, up to ${maxNameLength} characters each.`, status: 400 });
  }

  const [players, present] = await Promise.all([playerDevices(device), presentDeviceIds(device.code)]);
  if (!players.every((id) => id && present.has(id))) {
    return refuse({ error: "Both player devices must be connected.", status: 409 });
  }

  const refusal = await startMatch(device, { player1, player2 }, Date.now());
  if (refusal) return refuse(refusal);

  await publishChanged(device.code);
  return Response.json({}, { status: 201 });
});
