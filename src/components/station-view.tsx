"use client";

import Link from "next/link";
import { gameLabels, roleLabels, type Snapshot } from "@/lib/protocol";
import { useStation, type Station } from "@/lib/use-station";

const connectionLabels: Record<Station["connection"], string> = {
  connecting: "Connecting…",
  connected: "Connected",
  reconnecting: "Reconnecting…",
  failed: "Connection failed. Reload the page.",
};

export function StationView({ code, role }: { code: string; role: string }) {
  const { snapshot, present, connection, rejected } = useStation(code, role);

  if (rejected) {
    return (
      <main>
        <h1>This device has not joined</h1>
        <p>Enter the session code to take a seat.</p>
        <Link className="button" href="/">
          Join with a code
        </Link>
      </main>
    );
  }

  return (
    <main>
      <p className="connection" role="status" data-state={connection}>
        {connectionLabels[connection]}
      </p>
      {snapshot ? (
        <>
          <header>
            <p className="eyebrow">{gameLabels[snapshot.gameType]} session</p>
            <h1>{roleLabels[snapshot.role]}</h1>
          </header>
          <p className="code">
            <span className="eyebrow">Join code</span>
            <strong data-testid="join-code">{snapshot.code}</strong>
          </p>
          {/* Offline, this device cannot know who else is still connected. */}
          {snapshot.role === "operator" || snapshot.role === "display" ? (
            <Devices seats={snapshot.seats} present={connection === "connected" ? present : null} />
          ) : (
            <p>You are in. Wait for the operator to start.</p>
          )}
        </>
      ) : (
        <p>Loading the session…</p>
      )}
    </main>
  );
}

const seatLabels = {
  open: "Waiting to join",
  unknown: "Checking…",
  connected: "Connected",
  away: "Not connected",
};

function Devices({ seats, present }: { seats: Snapshot["seats"]; present: Station["present"] }) {
  const statusOf = (deviceIds: string[]): keyof typeof seatLabels => {
    if (!deviceIds.length) return "open";
    if (!present) return "unknown";
    return deviceIds.some((id) => present.has(id)) ? "connected" : "away";
  };

  return (
    <ul className="devices" aria-label="Devices">
      {seats.map(({ role, deviceIds }) => {
        const status = statusOf(deviceIds);
        return (
          <li key={role}>
            <span>{roleLabels[role]}</span>
            <span data-testid="seat-status" data-state={status}>
              {seatLabels[status]}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
