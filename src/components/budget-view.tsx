"use client";

import { useEffect, useState, type FormEvent } from "react";
import { budgetTotal, validAllocations, type BudgetConfig, type BudgetRound } from "@/lib/budget-state";
import { maxNameLength, type Snapshot } from "@/lib/protocol";
import type { Send, Station } from "@/lib/use-station";
import styles from "./budget-view.module.css";

const percent = new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 2 });
const draftKey = (roundId: string) => `budget-draft:${roundId}`;

type PendingDraft = { draftVersion: number; allocations: number[] };

function readDraft(roundId: string, config: BudgetConfig): PendingDraft | null {
  try {
    const value = JSON.parse(localStorage.getItem(draftKey(roundId)) ?? "null");
    return value && Number.isSafeInteger(value.draftVersion) && value.draftVersion > 0 &&
      validAllocations(value.allocations, config) ? value : null;
  } catch {
    return null;
  }
}

export function BudgetView({
  snapshot, send, connection,
}: { snapshot: Snapshot; send: Send; connection: Station["connection"] }) {
  const { budgetRound: round, role } = snapshot;

  useEffect(() => {
    if (role === "player1" && round?.phase === "confirmed") localStorage.removeItem(draftKey(round.id));
  }, [role, round?.id, round?.phase]);

  const playerJoined = snapshot.seats.some((seat) => seat.role === "player1" && seat.deviceIds.length > 0);

  return (
    <>
      {round?.phase === "confirmed" && (
        <section className={styles.round}>
          <h2>{round.playerName}’s allocation</h2>
          <ul className={styles.products} aria-label="Confirmed allocation">
            {round.config.products.map((product, index) => {
              const amount = round.allocations[index];
              const share = percent.format(amount / round.config.amount);
              return (
                <li key={product}>
                  <span>{product}</span>
                  <strong>{amount} ({share})</strong>
                  <span>Event average {percent.format(round.eventAverageShares[index])}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {role === "operator" && round?.phase !== "editing" && (
        <StartRound key={round?.id} send={send} playerJoined={playerJoined} />
      )}
      {role === "operator" && round?.phase === "editing" && <p>{round.playerName} is allocating their budget.</p>}
      {role === "display" && round?.phase === "editing" && (
        <section className={styles.round}>
          <h2>{round.playerName}’s budget</h2>
          <ul className={styles.products} aria-label="Products">
            {round.config.products.map((product) => <li key={product}>{product}</li>)}
          </ul>
        </section>
      )}
      {role === "player1" && !round && <p>You are in. Wait for the operator to start.</p>}
      {role === "player1" && round?.phase === "editing" && round.allocations && (
        <EditAllocation key={round.id} send={send} round={round} initial={round.allocations} connection={connection} />
      )}
    </>
  );
}

function StartRound({ send, playerJoined }: { send: Send; playerJoined: boolean }) {
  const [name, setName] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (starting || !name.trim() || !playerJoined) return;
    setStarting(true);
    setError("");
    try {
      await send("/api/budget", { action: "start", playerName: name });
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setStarting(false);
    }
  }

  return (
    <form onSubmit={start}>
      <label className="field">
        Player name
        <input required maxLength={maxNameLength} value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      {!playerJoined && <p className="hint">Pair the player device to start.</p>}
      <button disabled={starting || !playerJoined || !name.trim()}>Start budget round</button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

function EditAllocation({
  send, round, initial, connection,
}: {
  send: Send;
  round: Extract<BudgetRound, { phase: "editing" }>;
  initial: number[];
  connection: Station["connection"];
}) {
  const [draft, setDraft] = useState(() => {
    const saved = readDraft(round.id, round.config);
    return saved && saved.draftVersion >= round.draftVersion ? saved : null;
  });
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState("");
  const [saveError, setSaveError] = useState("");
  const { amount, step, products } = round.config;
  const allocations = draft?.allocations ?? initial;
  const allocated = budgetTotal(allocations);
  const remaining = amount - allocated;

  function rememberDraft(allocations: number[]) {
    const version = Math.max(round.draftVersion, draft?.draftVersion ?? 0, readDraft(round.id, round.config)?.draftVersion ?? 0);
    const pending = { draftVersion: version + 1, allocations };
    localStorage.setItem(draftKey(round.id), JSON.stringify(pending));
    setDraft(pending);
  }

  useEffect(() => {
    if (!draft || confirming || connection !== "connected") return;
    let superseded = false;
    const key = draftKey(round.id);
    const pending = JSON.stringify(draft);

    // A reload can restore the local draft immediately. Only the newest version can update the server.
    const timer = setTimeout(async () => {
      if (localStorage.getItem(key) !== pending) return;
      try {
        await send("/api/budget", { action: "draft", roundId: round.id, ...draft });
        if (localStorage.getItem(key) === pending) localStorage.removeItem(key);
        if (!superseded) setSaveError("");
      } catch (error) {
        if (!superseded) setSaveError((error as Error).message);
      }
    }, 150);

    return () => {
      superseded = true;
      clearTimeout(timer);
    };
  }, [send, round.id, draft, confirming, connection]);

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (remaining !== 0 || confirming) return;
    setConfirming(true);
    setConfirmError("");
    try {
      await send("/api/budget", { action: "confirm", roundId: round.id, allocations });
    } catch (error) {
      setConfirmError((error as Error).message);
    } finally {
      setConfirming(false);
    }
  }

  return (
    <form onSubmit={confirm}>
      <h2>Allocate your budget</h2>
      <div className={styles.totals}>
        <p>Allocated: {allocated}</p>
        <p>Remaining: {remaining}</p>
      </div>
      {products.map((product, index) => (
        <div className={styles.sliderField} key={product}>
          <div className={styles.sliderLabel}>
            <label htmlFor={`budget-product-${index}`}>{product}</label>
            <span>{allocations[index]}</span>
          </div>
          <input
            className={styles.slider}
            id={`budget-product-${index}`}
            type="range"
            min={0}
            max={allocations[index] + remaining}
            step={step}
            value={allocations[index]}
            disabled={confirming}
            onChange={(event) => {
              const requested = event.currentTarget.valueAsNumber;
              rememberDraft(allocations.map((value, slot) =>
                slot === index ? Math.min(requested, value + remaining) : value,
              ));
            }}
          />
        </div>
      ))}
      <button disabled={remaining !== 0 || confirming}>Confirm allocation</button>
      {confirmError && <p role="alert">{confirmError}</p>}
      {saveError && (
        <>
          <p role="alert">Draft could not be saved. {saveError}</p>
          <button type="button" disabled={confirming} onClick={() => rememberDraft(allocations)}>Retry saving draft</button>
        </>
      )}
    </form>
  );
}
