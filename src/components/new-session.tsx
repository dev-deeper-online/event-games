"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { postJson } from "@/lib/api-client";
import { tokenKey } from "@/lib/protocol/device";
import { gameLabels, gameTypes, type GameType } from "@/lib/protocol/roles";

export function NewSession() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [creating, startCreating] = useTransition();

  function create(gameType: GameType) {
    setError("");
    // Stays pending until the operator page is showing, so a second tap cannot create another session.
    startCreating(async () => {
      try {
        const { code, token } = await postJson<{ code: string; token: string }>("/api/sessions", { gameType });
        localStorage.setItem(tokenKey(code, "operator"), token);
        router.push(`/session/${code}/operator`);
      } catch (reason) {
        setError((reason as Error).message);
      }
    });
  }

  return (
    <>
      {gameTypes.map((gameType) => (
        <button key={gameType} type="button" disabled={creating} onClick={() => create(gameType)}>
          New {gameLabels[gameType].toLowerCase()} session
        </button>
      ))}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
