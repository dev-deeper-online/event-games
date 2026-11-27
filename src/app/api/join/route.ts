import { publishChanged } from "@/lib/ably";
import { deviceTokenPattern, maxNameLength, normalizeCode } from "@/lib/protocol";
import { joinSession } from "@/lib/sessions";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (typeof body?.code !== "string" || typeof body.token !== "string" || !deviceTokenPattern.test(body.token)) {
    return Response.json({ error: "Send a join code, your name and a device token." }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > maxNameLength) {
    return Response.json({ error: `Enter your name, up to ${maxNameLength} characters.` }, { status: 400 });
  }

  const code = normalizeCode(body.code);
  const refusal = await joinSession(code, name, body.token);
  if (refusal) return Response.json({ error: refusal.error }, { status: refusal.status });

  await publishChanged(code);
  return Response.json({ code }, { status: 201 });
}
