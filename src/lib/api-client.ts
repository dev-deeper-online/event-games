/** POSTs JSON and returns the parsed reply, throwing a message fit to show the person holding the device. */
export async function postJson<T>(url: string, body: unknown, headers?: Record<string, string>): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  }).catch(() => null);
  const reply = await response?.json().catch(() => null);
  if (!response?.ok || !reply) throw new Error(reply?.error ?? "Something went wrong. Check the connection and try again.");
  return reply;
}
