import { publishChanged } from "@/lib/ably";
import { submitAnswer } from "@/lib/quiz";
import { authenticate } from "@/lib/sessions";

export async function POST(request: Request) {
  // Read the clock first: this is the arrival time the answer is scored on.
  const receivedAt = Date.now();
  const device = await authenticate(request);
  if (!device) return Response.json({ error: "Unknown device." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const { matchId, question, choice } = body ?? {};
  if (typeof matchId !== "string" || !Number.isInteger(question) || !Number.isInteger(choice)) {
    return Response.json({ error: "Send a match, a question number and a choice." }, { status: 400 });
  }

  const refusal = await submitAnswer(device, { matchId, question, choice }, receivedAt);
  if (!refusal || refusal.stopped) await publishChanged(device.code);
  if (refusal) return Response.json({ error: refusal.error }, { status: refusal.status });

  return Response.json({}, { status: 201 });
}
