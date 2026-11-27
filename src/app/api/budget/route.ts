import { publishBudgetResultsChanged, publishChanged } from "@/lib/ably";
import { saveBudgetAllocations } from "@/lib/budget";
import { authenticate } from "@/lib/sessions";

const roundIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const device = await authenticate(request);
  if (!device) return Response.json({ error: "Unknown device." }, { status: 401 });
  if (device.gameType !== "budget") return Response.json({ error: "This is not a budget session." }, { status: 403 });

  const body = await request.json().catch(() => null);
  // A guest may retry the confirmation that ended its round; the round itself checks the device.
  if (device.role === "display") {
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
    device, body.roundId, body.allocations, confirm ? null : body.draftVersion, Date.now(),
  );
  if (refusal) return Response.json({ error: refusal.error }, { status: refusal.status });
  // Confirming frees the slot, which every device of the session needs to hear about.
  if (confirm) await Promise.all([publishChanged(device.code), publishBudgetResultsChanged()]);
  return Response.json({});
}
