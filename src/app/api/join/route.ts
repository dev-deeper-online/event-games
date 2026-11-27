import { publishChanged } from "@/lib/ably";
import { deviceTokenPattern, joinableRoles, normalizeCode } from "@/lib/protocol";
import { joinSession } from "@/lib/sessions";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const role = joinableRoles.find((candidate) => candidate === body?.role);
  if (!role || typeof body.code !== "string" || typeof body.token !== "string" || !deviceTokenPattern.test(body.token)) {
    return Response.json({ error: "Send a join code, a role and a device token." }, { status: 400 });
  }

  const code = normalizeCode(body.code);
  const refusal = await joinSession(code, role, body.token);
  if (refusal) return Response.json({ error: refusal.error }, { status: refusal.status });

  await publishChanged(code);
  return Response.json({ code }, { status: 201 });
}
