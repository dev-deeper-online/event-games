import { createHttpClient, type PubSubHttpClient } from "@ably/pubsub-server";
import { budgetResultsChannel, channelName, type GameType } from "./protocol";

let client: PubSubHttpClient | undefined;

// Created on first use: the constructor throws without a key, which must not break the build.
const ably = () => {
  if (!process.env.ABLY_API_KEY) throw new Error("ABLY_API_KEY is not set");
  return (client ??= createHttpClient({ key: process.env.ABLY_API_KEY }));
};

/** Presence is scoped to a session. Budget devices can also receive event-wide result updates. */
export const tokenRequestFor = (code: string, deviceId: string, gameType: GameType) =>
  ably().auth.createTokenRequest({
    clientId: deviceId,
    capability: {
      [channelName(code)]: ["subscribe", "presence"],
      ...(gameType === "budget" && { [budgetResultsChannel]: ["subscribe"] }),
    },
  });

/** Ids of the devices connected to a session's live channel right now. */
export async function presentDeviceIds(code: string) {
  const { items } = await ably().channels.get(channelName(code)).presence.get();
  return new Set(items.map((member) => member.clientId));
}

export const publishChanged = (code: string) => publishSnapshotChange(channelName(code));
export const publishBudgetResultsChanged = () => publishSnapshotChange(budgetResultsChannel);

/**
 * Tells subscribed devices to fetch a new snapshot after the change is committed.
 * A failure is logged because the change is already saved and devices catch up on their next snapshot.
 */
async function publishSnapshotChange(channel: string) {
  try {
    await ably().channels.get(channel).publish("changed", null);
  } catch (error) {
    console.error(`Could not publish a change on ${channel}`, error);
  }
}
