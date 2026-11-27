"use client";

import { useState, useTransition } from "react";
import { Countdown } from "@/components/countdown";
import { isPlayer, playerSlots, type Role } from "@/lib/protocol/roles";
import type { LeaderboardEntry, Match, ShownMatch } from "@/lib/protocol/snapshot";
import type { Send } from "@/lib/use-station";

/** Runs one command at a time, keeping the message from the last one that failed. */
export function useCommand(send: Send) {
  const [error, setError] = useState("");
  const [pending, startCommand] = useTransition();
  const run = (url: string, body: unknown) => {
    setError("");
    startCommand(async () => {
      try {
        await send(url, body);
      } catch (reason) {
        setError((reason as Error).message);
      }
    });
  };
  return { run, pending, error };
}

export function StopMatch({ matchId, send }: { matchId: string; send: Send }) {
  const { run, pending, error } = useCommand(send);

  return (
    <>
      {error && <p role="alert">{error}</p>}
      <button type="button" disabled={pending} onClick={() => run("/api/match/stop", { matchId })}>
        Stop match
      </button>
    </>
  );
}

type Played = Extract<Match, { result: unknown }>;

const lastQuestion = ({ players, result }: Played) =>
  result.scorer ? `${players[result.scorer].name} takes ${result.points} points` : "No points this time";

/** Every answer to the question so far, wrong or scoring. The choice itself is never part of it. */
function Outcomes({ match }: { match: ShownMatch }) {
  if (!match.outcomes.length) return null;
  return (
    <ul className="outcomes" aria-label="Answers">
      {match.outcomes.map((outcome) => (
        <li key={outcome.id} data-kind={outcome.kind}>
          {outcome.kind === "wrong"
            ? `${match.players[outcome.player].name} answered wrong`
            : `${match.players[outcome.player].name} takes ${outcome.points} points`}
        </li>
      ))}
    </ul>
  );
}

function Scores({ players }: { players: Match["players"] }) {
  return (
    <ul className="rows" aria-label="Scores">
      {playerSlots.quiz.map((player) => (
        <li key={player}>
          <span>{players[player].name}</span>
          <strong>{players[player].score}</strong>
        </li>
      ))}
    </ul>
  );
}

/** The match as one device sees it. Players tap the choices; the display only reads them. */
export function QuizMatch({ match, role, send }: { match: Match; role: Role; send: Send }) {
  if (match.phase === "countdown") {
    return (
      <section className="match">
        <p className="eyebrow">Get ready</p>
        <h2>
          {match.players.player1.name} vs {match.players.player2.name}
        </h2>
        <Countdown startsInMs={match.startsInMs} />
      </section>
    );
  }
  if (match.phase === "complete") {
    return (
      <section className="match">
        <h2>Match over</h2>
        <p className="result">Last question: {lastQuestion(match)}</p>
        <Scores players={match.players} />
      </section>
    );
  }

  const { question } = match;
  const player = isPlayer(role);
  return (
    <section className="match">
      <p className="eyebrow">
        Question {question.number} of {match.questionCount}
      </p>
      <h2>{question.prompt}</h2>
      {player ? (
        // Keyed by question, so a message about one never carries over to the next.
        <Choices key={`${match.id}/${question.number}`} match={match} send={send} />
      ) : (
        <ol className="choices" aria-label="Choices">
          {question.choices.map((choice, index) => (
            <li key={index}>{choice}</li>
          ))}
        </ol>
      )}
      <Outcomes match={match} />
      {match.phase === "closed" ? (
        !match.result.scorer && <p className="result">No points this time</p>
      ) : (
        player && !match.canAnswer && <p role="status">Wrong answer. Wait for the next question.</p>
      )}
      <Scores players={match.players} />
    </section>
  );
}

function Choices({ match, send }: { match: ShownMatch; send: Send }) {
  const { run, pending, error } = useCommand(send);
  const open = match.phase === "open" && match.canAnswer;
  const retryId = match.phase === "open" ? match.retryId : undefined;

  return (
    <>
      <div className="choices" role="group" aria-label="Choices">
        {match.question.choices.map((choice, index) => (
          <button
            key={index}
            type="button"
            disabled={!open || pending}
            onClick={() => run("/api/answer", { matchId: match.id, question: match.question.number, choice: index, retryId })}
          >
            {choice}
          </button>
        ))}
      </div>
      {/* Once the question is settled for this player, a refused tap no longer needs explaining. */}
      {open && error && <p role="alert">{error}</p>}
    </>
  );
}

const ordinals = new Intl.PluralRules("en", { type: "ordinal" });
const suffixes = { one: "st", two: "nd", few: "rd", other: "th", zero: "th", many: "th" };
const ordinal = (rank: number) => `${rank}${suffixes[ordinals.select(rank)]}`;

export function QuizLeaderboard({ entries }: { entries: LeaderboardEntry[] }) {
  return (
    <section aria-labelledby="leaderboard-heading">
      <h2 id="leaderboard-heading">Event leaderboard</h2>
      {entries.length ? (
        <table className="leaderboard" aria-labelledby="leaderboard-heading">
          <thead>
            <tr>
              <th scope="col">Rank</th>
              <th scope="col">Player</th>
              <th scope="col">Score</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(({ id, name, rank, score }) => (
              <tr key={id}>
                <td className="rank" data-rank={rank}>{ordinal(rank)}</td>
                <td>{name}</td>
                <td>{score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>No completed matches yet.</p>
      )}
    </section>
  );
}
