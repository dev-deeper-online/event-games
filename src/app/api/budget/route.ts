import { publishBudgetResultsChanged, publishChanged } from "@/lib/ably";
import { saveBudgetAllocations, type BudgetSave } from "@/lib/budget";
import { asDevice, refuse } from "@/lib/route";

const roundIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST = (request: Request) => asDevice(request, async (device) => {
  if (device.gameType !== "budget") return refuse({ error: "This is not a budget session.", status: 403 });

  const body = await request.json().catch(() => null);
  // A guest may retry the confirmation that ended its round; the round itself checks the device.
  if (device.role === "display") {
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
  const refusal = await saveBudgetAllocations(device, body.roundId, body.allocations, save, Date.now());
  if (refusal) return refuse(refusal);
  // Confirming frees the slot, which every device of the session needs to hear about.
  if (action === "confirm") await Promise.all([publishChanged(device.code), publishBudgetResultsChanged()]);
  return Response.json({});
});
