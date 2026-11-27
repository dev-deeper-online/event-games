import { publishChanged, publishLeaderboardChanged } from "@/lib/ably";
import { submitAnswer } from "@/lib/quiz";
import { asDevice, refuse } from "@/lib/route";

export async function POST(request: Request) {
  // Read the clock first: this is the arrival time the answer is scored on.
  const receivedAt = Date.now();

  return asDevice(request, async (device) => {
    const body = await request.json().catch(() => null);
    const { matchId, question, choice, retryId } = body ?? {};
    if (typeof matchId !== "string" || !Number.isInteger(question) || !Number.isInteger(choice) ||
        (retryId !== undefined && typeof retryId !== "string")) {
      return refuse({ error: "Send a match, a question number and a choice.", status: 400 });
    }

    const result = await submitAnswer(device, { matchId, question, choice, retryId }, receivedAt);
    if ("error" in result) {
      if (result.stopped) await publishChanged(device.code);
      return refuse(result);
    }

    await Promise.all([publishChanged(device.code), result.completed && publishLeaderboardChanged()]);
    return Response.json({}, { status: 201 });
  });
}
