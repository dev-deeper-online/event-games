import { publishChanged } from "@/lib/ably";
import { saveBudgetAllocations, startBudgetRound } from "@/lib/budget";
import { maxNameLength } from "@/lib/protocol";
import { authenticate } from "@/lib/sessions";

const roundIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const device = await authenticate(request);
  if (!device) return Response.json({ error: "Unknown device." }, { status: 401 });
  if (device.gameType !== "budget") return Response.json({ error: "This is not a budget session." }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (body?.action === "start") {
    if (device.role !== "operator") {
      return Response.json({ error: "Only the operator can start a budget round." }, { status: 403 });
    }
    const name = typeof body.playerName === "string" ? body.playerName.trim() : "";
    if (!name || name.length > maxNameLength) {
      return Response.json({ error: `Enter a player name up to ${maxNameLength} characters.` }, { status: 400 });
    }
    if (!await startBudgetRound(device.sessionId, name)) {
      return Response.json({ error: "The player device must join and any active round must finish." }, { status: 409 });
    }
    await publishChanged(device.code);
    return Response.json({}, { status: 201 });
  }

  if (device.role !== "player1") {
    return Response.json({ error: "Only the player can change the allocation." }, { status: 403 });
  }
  const action = body?.action;
  if ((action !== "draft" && action !== "confirm") ||
      typeof body.roundId !== "string" || !roundIdPattern.test(body.roundId)) {
    return Response.json({ error: "Send a valid budget round and action." }, { status: 400 });
  }

  const confirm = action === "confirm";
  if (!confirm && (!Number.isSafeInteger(body.draftVersion) || body.draftVersion < 1)) {
    return Response.json({ error: "Send a valid draft version." }, { status: 400 });
  }
  const refusal = await saveBudgetAllocations(
    device.sessionId, body.roundId, body.allocations, confirm ? null : body.draftVersion,
  );
  if (refusal) return Response.json({ error: refusal.error }, { status: refusal.status });
  if (confirm) await publishChanged(device.code);
  return Response.json({});
}
