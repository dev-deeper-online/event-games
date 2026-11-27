import { publishChanged } from "@/lib/ably";
import { submitAnswer } from "@/lib/quiz";
import { authenticate } from "@/lib/sessions";

export async function POST(request: Request) {
  // Read the clock first: this is the arrival time the answer is scored on.
  const receivedAt = Date.now();
  const retryId = new URL(request.url).searchParams.get("retry") ?? undefined;
  const device = await authenticate(request);
  if (!device) return Response.json({ error: "Unknown device." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const { matchId, question, choice } = body ?? {};
  if (typeof matchId !== "string" || !Number.isInteger(question) || !Number.isInteger(choice)) {
    return Response.json({ error: "Send a match, a question number and a choice." }, { status: 400 });
  }

  const refusal = await submitAnswer(device, { matchId, question, choice, retryId }, receivedAt);
  if (refusal) return Response.json({ error: refusal.error }, { status: refusal.status });

  await publishChanged(device.code);
  return Response.json({}, { status: 201 });
}
