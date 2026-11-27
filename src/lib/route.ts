import type { Refusal } from "./refusal";
import { authenticate, type Device } from "./sessions";

export const refuse = ({ error, status }: Refusal) => Response.json({ error }, { status });

/** Runs `handle` for the device that sent the request, and refuses a request without a known token. */
export async function asDevice(request: Request, handle: (device: Device) => Promise<Response>) {
  const device = await authenticate(request);
  return device ? handle(device) : refuse({ error: "Unknown device.", status: 401 });
}
