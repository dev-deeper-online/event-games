import { publishChanged } from "@/lib/ably";
import { asDevice, refuse } from "@/lib/route";
import { markReady } from "@/lib/sessions";

export const POST = (request: Request) => asDevice(request, async (device) => {
  const refusal = await markReady(device, Date.now());
  if (refusal) return refuse(refusal);

  await publishChanged(device.code);
  return Response.json({}, { status: 201 });
});
