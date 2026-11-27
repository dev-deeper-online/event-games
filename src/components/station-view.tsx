"use client";

import Link from "next/link";
import { QuizMatch, StartMatch, StopMatch } from "@/components/quiz-view";
import { gameLabels, playerSlots, roleLabels, type Snapshot } from "@/lib/protocol";
import { useStation, type Send, type Station } from "@/lib/use-station";

const connectionLabels: Record<Station["connection"], string> = {
  connecting: "Connecting…",
  connected: "Connected",
  reconnecting: "Reconnecting…",
  failed: "Connection failed. Reload the page.",
};

export function StationView({ code, role }: { code: string; role: string }) {
  const { snapshot, present, connection, rejected, send } = useStation(code, role);

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
        // Offline, this device cannot know who else is still connected.
        <Session snapshot={snapshot} present={connection === "connected" ? present : null} send={send} />
      ) : (
        <p>Loading the session…</p>
      )}
    </main>
  );
}

function Session({ snapshot, present, send }: { snapshot: Snapshot; present: Station["present"]; send: Send }) {
  const { role, match, stopNotice } = snapshot;
  const running = match !== null && match.phase !== "complete";
  const staff = role === "operator" || role === "display";
  // The display gives the whole screen to a running match.
  const matchOnly = running && role === "display";
  const playersReady = snapshot.seats
    .filter((seat) => (playerSlots[snapshot.gameType] as readonly string[]).includes(seat.role))
    .every((seat) => seat.deviceIds.some((id) => present?.has(id)));

  if (role === "display" && stopNotice) {
    return (
      <section className="match" role="status">
        <h1>Match stopped</h1>
        <p>{stopNotice.reason === "operator" ? "The operator ended the match." : "A player device disconnected."}</p>
      </section>
    );
  }

  return (
    <>
      {!matchOnly && (
        <header>
          <p className="eyebrow">{gameLabels[snapshot.gameType]} session</p>
          <h1>{roleLabels[role]}</h1>
        </header>
      )}
      {match && <QuizMatch match={match} role={role} send={send} />}
      {role === "operator" && running && <StopMatch key={match.id} matchId={match.id} send={send} />}
      {!matchOnly && (
        <>
          {(!running || role === "operator") && (
            <p className="code">
              <span className="eyebrow">Join code</span>
              <strong data-testid="join-code">{snapshot.code}</strong>
            </p>
          )}
          {role === "operator" && snapshot.gameType === "quiz" && !running && (
            <StartMatch key={match?.id} ready={playersReady} send={send} />
          )}
          {staff && <Devices seats={snapshot.seats} present={present} />}
        </>
      )}
      {!staff && !running && <p>You are in. Wait for the operator to start.</p>}
    </>
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
    <ul className="rows devices" aria-label="Devices">
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
