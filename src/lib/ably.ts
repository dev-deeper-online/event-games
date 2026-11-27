import { createHttpClient, type PubSubHttpClient } from "@ably/pubsub-server";
import { channelName, isQuizDisplay, leaderboardChannel } from "./protocol";
import type { Device } from "./sessions";

let client: PubSubHttpClient | undefined;

// Created on first use: the constructor throws without a key, which must not break the build.
const ably = () => {
  if (!process.env.ABLY_API_KEY) throw new Error("ABLY_API_KEY is not set");
  return (client ??= createHttpClient({ key: process.env.ABLY_API_KEY }));
};

/** Only quiz displays listen for event-wide leaderboard changes. */
export const tokenRequestFor = (device: Device) =>
  ably().auth.createTokenRequest({
    clientId: device.deviceId,
    capability: {
      [channelName(device.code)]: ["subscribe", "presence"],
      ...(isQuizDisplay(device) ? { [leaderboardChannel]: ["subscribe"] } : {}),
    },
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
export const publishChanged = (code: string) => publishChange(channelName(code));

export const publishLeaderboardChanged = () => publishChange(leaderboardChannel);

async function publishChange(channel: string) {
  try {
    await ably().channels.get(channel).publish("changed", null);
  } catch (error) {
    console.error(`Could not publish a change on ${channel}`, error);
  }
}
