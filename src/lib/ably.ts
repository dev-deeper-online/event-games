import { createHttpClient, type PubSubHttpClient } from "@ably/pubsub-server";
import { channelName } from "./protocol";

let client: PubSubHttpClient | undefined;

// Created on first use: the constructor throws without a key, which must not break the build.
const ably = () => {
  if (!process.env.ABLY_API_KEY) throw new Error("ABLY_API_KEY is not set");
  return (client ??= createHttpClient({ key: process.env.ABLY_API_KEY }));
};

/** Devices may listen and announce themselves on their own session's channel. Only the server publishes. */
export const tokenRequestFor = (code: string, deviceId: string) =>
  ably().auth.createTokenRequest({
    clientId: deviceId,
    capability: { [channelName(code)]: ["subscribe", "presence"] },
  });

/** Ids of the devices connected to a session's live channel right now. */
export async function presentDeviceIds(code: string) {
  const { items } = await ably().channels.get(channelName(code)).presence.get();
  return new Set(items.map((member) => member.clientId));
}

/**
 * Tells a session's devices to fetch a new snapshot. Call after the change is committed.
 * A failure is logged and swallowed: the change is already saved, and devices catch up on their next snapshot.
 */
export async function publishChanged(code: string) {
  try {
    await ably().channels.get(channelName(code)).publish("changed", null);
  } catch (error) {
    console.error(`Could not publish a change for session ${code}`, error);
  }
}
