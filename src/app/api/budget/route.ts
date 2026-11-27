import { publishBudgetResultsChanged, publishChanged } from "@/lib/ably";
import { saveBudgetAllocations, startBudgetRound, type BudgetSave } from "@/lib/budget";
import { maxNameLength, playerName } from "@/lib/protocol/roles";
import { asDevice, refuse } from "@/lib/route";

const roundIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST = (request: Request) => asDevice(request, async (device) => {
  if (device.gameType !== "budget") return refuse({ error: "This is not a budget session.", status: 403 });

  const body = await request.json().catch(() => null);
  if (body?.action === "start") {
    if (device.role !== "operator") {
      return refuse({ error: "Only the operator can start a budget round.", status: 403 });
    }
    const name = playerName(body.playerName);
    if (!name) {
      return refuse({ error: `Enter a player name up to ${maxNameLength} characters.`, status: 400 });
    }
    if (!await startBudgetRound(device.sessionId, name)) {
      return refuse({ error: "The player device must join and any active round must finish.", status: 409 });
    }
    await publishChanged(device.code);
    return Response.json({}, { status: 201 });
  }

  if (device.role !== "player1") {
    return refuse({ error: "Only the player can change the allocation.", status: 403 });
  }
  const action = body?.action;
  if ((action !== "draft" && action !== "confirm") ||
      typeof body.roundId !== "string" || !roundIdPattern.test(body.roundId)) {
    return refuse({ error: "Send a valid budget round and action.", status: 400 });
  }

  if (action === "draft" && (!Number.isSafeInteger(body.draftVersion) || body.draftVersion < 1)) {
    return refuse({ error: "Send a valid draft version.", status: 400 });
  }
  const save: BudgetSave = action === "confirm" ? { action } : { action, version: body.draftVersion };
  const refusal = await saveBudgetAllocations(device.sessionId, body.roundId, body.allocations, save);
  if (refusal) return refuse(refusal);
  if (action === "confirm") await publishBudgetResultsChanged();
  return Response.json({});
});
