import { tokenRequestFor } from "@/lib/ably";
import { asDevice } from "@/lib/route";

export const GET = (request: Request) =>
  asDevice(request, async (device) =>
    Response.json(await tokenRequestFor(device), { headers: { "cache-control": "no-store" } }),
  );
