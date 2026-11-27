"use client";

import { createClient, type PubSubClient } from "@ably/pubsub-device";
import { useCallback, useEffect, useRef, useState } from "react";
import { postJson } from "./api-client";
import { budgetResultsChannel, channelName, isQuizDisplay, leaderboardChannel, tokenKey, type Snapshot } from "./protocol";

export type Station = {
  snapshot: Snapshot | null;
  /** Ids of the devices connected to the live channel, or null until Ably has reported them. */
  present: ReadonlySet<string> | null;
  connection: "connecting" | "connected" | "reconnecting" | "failed";
  /** True when this browser holds no valid token for the seat. */
  rejected: boolean;
};

/** Sends a command as this device, then catches up whether or not it was accepted. */
export type Send = (url: string, body: unknown) => Promise<void>;

const initial: Station = { snapshot: null, present: null, connection: "connecting", rejected: false };

/** Keeps one device's view of its session current: snapshot on join and reconnect, then on every change. */
export function useStation(code: string, role: string): Station & { send: Send } {
  const [station, setStation] = useState(initial);
  const refreshNow = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    const update = (patch: Partial<Station>) => setStation((current) => ({ ...current, ...patch }));
    const key = tokenKey(code, role);
    const token = localStorage.getItem(key);
    const headers = { authorization: `Bearer ${token}` };
    let realtime: PubSubClient | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let latest = 0;
    let stopped = false;
    let watchingEventResults = false;

    const stop = () => {
      stopped = true;
      clearTimeout(retry);
      realtime?.close();
    };

    const reject = () => {
      localStorage.removeItem(key);
      stop();
      update({ rejected: true });
    };

    const refresh = async () => {
      const request = ++latest;
      clearTimeout(retry);
      try {
        const response = await fetch("/api/snapshot", { headers });
        if (stopped) return;
        if (response.status === 401) return reject();
        if (!response.ok) throw new Error(`Snapshot failed with ${response.status}`);
        const snapshot: Snapshot = await response.json();
        // Replies can arrive out of order; only the newest request may win.
        if (stopped || request !== latest) return;
        update({ snapshot });
        const eventChannel = snapshot.gameType === "budget" ? budgetResultsChannel
          : isQuizDisplay(snapshot) ? leaderboardChannel : null;
        if (eventChannel && realtime && !watchingEventResults) {
          watchingEventResults = true;
          const results = realtime.channels.get(eventChannel);
          results.on(["attached", "update"], () => void refresh());
          results.subscribe("changed", () => void refresh()).catch(console.error);
        }
        // Nothing is published when the pause ends, so each device asks again when the next question opens.
        if (snapshot.match?.phase === "closed") retry = setTimeout(refresh, snapshot.match.nextInMs);
      } catch {
        if (!stopped && request === latest) retry = setTimeout(refresh, 2000);
      }
    };

    const connect = () => {
      realtime = createClient({
        authCallback: async (_params, callback) => {
          try {
            const response = await fetch("/api/ably-token", { headers });
            if (!response.ok) throw new Error(`Live update sign-in failed with ${response.status}`);
            callback(null, await response.json());
          } catch (error) {
            callback(String(error), null);
          }
        },
      });
      const channel = realtime.channels.get(channelName(code));

      realtime.connection.on(({ current }) => {
        if (stopped) return;
        if (current === "connected") {
          update({ connection: "connected" });
          void refresh();
        } else if (current === "failed") {
          update({ connection: "failed" });
        } else if (current === "disconnected" || current === "suspended") {
          update({ connection: "reconnecting" });
        }
      });
      // Retried until it succeeds; after that Ably re-enters presence by itself on later reconnects.
      const enter = () => {
        if (!stopped) channel.presence.enter().catch(() => setTimeout(enter, 2000));
      };
      realtime.connection.once("connected", enter);

      const syncPresence = async () => {
        const members = await channel.presence.get();
        if (!stopped) update({ present: new Set(members.map((member) => member.clientId)) });
      };

      // A change committed before the channel attached, or during a gap Ably could not replay, sends no message.
      channel.on(["attached", "update"], () => void refresh());

      // Both can reject while the connection is down; the reconnect delivers the same events again.
      channel.subscribe("changed", () => void refresh()).catch(console.error);
      channel.presence
        .subscribe(() => {
          syncPresence().catch(console.error);
          // A device that appears may be one the snapshot has not seen yet.
          void refresh();
        })
        .catch(console.error);
    };

    const start = async () => {
      if (!token) return reject();
      refreshNow.current = refresh;
      connect();
      await refresh();
    };
    void start();

    return () => {
      stop();
      // Next.js keeps hidden pages alive, so a return visit must not start from a stale view.
      setStation(initial);
    };
  }, [code, role]);

  const send = useCallback<Send>(
    async (url, body) => {
      try {
        await postJson(url, body, { authorization: `Bearer ${localStorage.getItem(tokenKey(code, role))}` });
      } finally {
        // The "changed" message can be lost, and a refusal usually means this view is out of date.
        // Awaited, so the buttons stay disabled until the view has caught up.
        await refreshNow.current();
      }
    },
    [code, role],
  );

  return { ...station, send };
}
