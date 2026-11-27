import { gameTypes } from "@/lib/protocol/roles";
import { refuse } from "@/lib/route";
import { createSession } from "@/lib/sessions";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const gameType = gameTypes.find((type) => type === body?.gameType);
  if (!gameType) return refuse({ error: "Unknown game type.", status: 400 });

  return Response.json(await createSession(gameType), { status: 201 });
}
