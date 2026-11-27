"use client";

import Link from "next/link";
import { BudgetView } from "@/components/budget-view";
import { QuizLeaderboard, QuizMatch, StopMatch, useCommand } from "@/components/quiz-view";
import { JoinPanel } from "@/components/qr-code";
import { gameLabels, roleLabels, tokenKey, type Snapshot } from "@/lib/protocol";
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
        <p>Scan the code on the display, or enter the session code, to take a seat.</p>
        <Link className="button" href="/">
          Join with a code
        </Link>
      </main>
    );
  }

  return (
    <main className={role === "display" ? "wide" : undefined}>
      <p className="connection" role="status" data-state={connection}>
        {connectionLabels[connection]}
      </p>
      {snapshot ? (
        // Offline, this device cannot know who else is still connected.
        <Session snapshot={snapshot} present={connection === "connected" ? present : null} send={send} connection={connection} />
      ) : (
        <p>Loading the session…</p>
      )}
    </main>
  );
}

function Session({ snapshot, present, send, connection }: {
  snapshot: Snapshot;
  present: Station["present"];
  send: Send;
  connection: Station["connection"];
}) {
  const { role, match, budgetRound, leaderboard, stopNotice, gameType } = snapshot;
  const display = role === "display";
  const running = (match !== null && match.phase !== "complete") || (budgetRound !== null && budgetRound.phase !== "confirmed");
  // The display gives the whole screen to a running round.
  const matchOnly = running && display;
  // A player or guest only ever sees its own rounds, so before its first one it is in the lobby.
  const waiting = !display && (gameType === "quiz" ? !match : !budgetRound);

  if (display && stopNotice) {
    return (
      <section className="match" role="status">
        <h1>Match stopped</h1>
        <p>{stopNotice.reason === "display" ? "The match was stopped." : "A player device disconnected."}</p>
      </section>
    );
  }

  return (
    <>
      {!matchOnly && (
        <header>
          <p className="eyebrow">{gameLabels[gameType]} session</p>
          <h1>{roleLabels[role]}</h1>
        </header>
      )}
      {match && <QuizMatch match={match} role={role} send={send} />}
      {display && match && match.phase !== "complete" && <StopMatch key={match.id} matchId={match.id} send={send} />}
      {gameType === "budget" && <BudgetView snapshot={snapshot} send={send} connection={connection} />}
      {waiting && <Lobby snapshot={snapshot} send={send} />}
      {role === "guest" && !waiting && <PlayAgain snapshot={snapshot} send={send} />}
      {display && !running && (
        <div className="idle">
          <JoinPanel code={snapshot.code} />
          {leaderboard && <QuizLeaderboard entries={leaderboard} />}
        </div>
      )}
      {!display && leaderboard && <QuizLeaderboard entries={leaderboard} />}
      {display && !running && <Devices seats={snapshot.seats} present={present} />}
    </>
  );
}

function PlayAgain({ snapshot: { code, me }, send }: { snapshot: Snapshot; send: Send }) {
  const { run, pending, error } = useCommand(send);
  // The same token reseats this device in a free slot.
  const again = () => run("/api/join", { code, name: me.name, token: localStorage.getItem(tokenKey(code, "player")) });

  return (
    <>
      {error && <p role="alert">{error}</p>}
      <button type="button" disabled={pending || !me.name} onClick={again}>
        Play again
      </button>
    </>
  );
}

function Lobby({ snapshot, send }: { snapshot: Snapshot; send: Send }) {
  const { run, pending, error } = useCommand(send);
  const { me, role, gameType } = snapshot;
  if (role === "guest") return <PlayAgain snapshot={snapshot} send={send} />;

  return (
    <section className="lobby">
      <p>
        You are in as <strong>{me.name}</strong>.
      </p>
      {me.ready ? (
        <p className="hint">{gameType === "quiz" ? "Waiting for the other player." : "Starting soon."}</p>
      ) : (
        <>
          {error && <p role="alert">{error}</p>}
          <button type="button" disabled={pending} onClick={() => run("/api/ready", {})}>
            Ready
          </button>
        </>
      )}
    </section>
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
      {seats.map(({ role, deviceIds, name, ready }) => {
        const status = statusOf(deviceIds);
        return (
          <li key={role}>
            <span>
              {roleLabels[role]}
              {name && <strong className="seat-name">{name}</strong>}
            </span>
            {ready && <span data-testid="seat-ready">Ready</span>}
            <span data-testid="seat-status" data-state={status}>
              {seatLabels[status]}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
