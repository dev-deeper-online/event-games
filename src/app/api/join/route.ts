import { publishChanged } from "@/lib/ably";
import { deviceTokenPattern, normalizeCode } from "@/lib/protocol/device";
import { maxNameLength, parsePlayerName } from "@/lib/protocol/roles";
import { refuse } from "@/lib/route";
import { joinSession } from "@/lib/sessions";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (typeof body?.code !== "string" || typeof body.token !== "string" || !deviceTokenPattern.test(body.token)) {
    return refuse({ error: "Send a join code, your name and a device token.", status: 400 });
  }
  const name = parsePlayerName(body.name);
  if (!name) return refuse({ error: `Enter your name, up to ${maxNameLength} characters.`, status: 400 });

  const code = normalizeCode(body.code);
  const refusal = await joinSession(code, name, body.token);
  if (refusal) return refuse(refusal);

  await publishChanged(code);
  return Response.json({ code }, { status: 201 });
}
