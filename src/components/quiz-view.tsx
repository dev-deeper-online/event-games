"use client";

import { useState, useTransition, type FormEvent } from "react";
import { isPlayer, maxNameLength, playerSlots, roleLabels, type LeaderboardEntry, type Match, type Role } from "@/lib/protocol";
import type { Send } from "@/lib/use-station";

/** Runs one command at a time, keeping the message from the last one that failed. */
function useCommand(send: Send) {
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

export function StartMatch({ ready, send }: { ready: boolean; send: Send }) {
  const { run, pending, error } = useCommand(send);

  function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    run("/api/match", Object.fromEntries(new FormData(event.currentTarget)));
  }

  return (
    <form onSubmit={start}>
      {playerSlots.quiz.map((player) => (
        <label key={player} className="field">
          {roleLabels[player]} name
          {/* The pattern refuses a name made of spaces only. */}
          <input name={player} required pattern=".*\S.*" maxLength={maxNameLength} autoComplete="off" />
        </label>
      ))}
      {!ready && <p className="hint">Both player devices must be connected before the match can start.</p>}
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={!ready || pending}>
        Start match
      </button>
    </form>
  );
}

const outcome = ({ players, result }: Extract<Match, { result: unknown }>) =>
  result.scorer ? `${players[result.scorer].name} takes ${result.points} points` : "No points this time";

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

/** The match as one device sees it. Players tap the choices; the display and operator only read them. */
export function QuizMatch({ match, role, send }: { match: Match; role: Role; send: Send }) {
  if (match.phase === "complete") {
    return (
      <section className="match">
        <h2>Match over</h2>
        <p className="result">Last question: {outcome(match)}</p>
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
      {match.phase === "closed" ? (
        <p className="result" role="status">
          {outcome(match)}
        </p>
      ) : (
        player && !match.canAnswer && <p role="status">Wrong answer. Wait for the next question.</p>
      )}
      <Scores players={match.players} />
    </section>
  );
}

function Choices({ match, send }: { match: Match; send: Send }) {
  const { run, pending, error } = useCommand(send);
  const open = match.phase === "open" && match.canAnswer;
  const retryId = match.phase === "open" ? match.retryId : undefined;
  const answerUrl = retryId ? `/api/answer?retry=${encodeURIComponent(retryId)}` : "/api/answer";

  return (
    <>
      <div className="choices" role="group" aria-label="Choices">
        {match.question.choices.map((choice, index) => (
          <button
            key={index}
            type="button"
            disabled={!open || pending}
            onClick={() => run(answerUrl, { matchId: match.id, question: match.question.number, choice: index })}
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
                <td>{rank}</td>
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
