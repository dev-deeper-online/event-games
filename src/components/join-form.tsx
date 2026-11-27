"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { postJson } from "@/lib/api-client";
import { maxNameLength, normalizeCode, tokenKey } from "@/lib/protocol";

// getRandomValues also works on a plain http address, where randomUUID does not.
const newDeviceToken = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");

/** The fallback for a guest who cannot scan: the code leads to the same join page. */
export function CodeForm() {
  const router = useRouter();

  function open(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = normalizeCode(String(new FormData(event.currentTarget).get("code")));
    router.push(`/join/${code}`);
  }

  return (
    <form onSubmit={open}>
      <label className="field">
        Join code
        <input
          name="code"
          required
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          className="code-input"
        />
      </label>
      <button type="submit">Continue</button>
    </form>
  );
}

export function JoinForm({ code: rawCode }: { code: string }) {
  const code = normalizeCode(rawCode);
  const router = useRouter();
  const [error, setError] = useState("");
  const [joining, startJoining] = useTransition();

  function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name")).trim();
    setError("");
    // Stays pending until the station page is showing, so a second tap cannot join twice.
    startJoining(async () => {
      // Saved before sending: if the reply is lost, the next try asks for a seat with the same token.
      const key = tokenKey(code, "player");
      const token = localStorage.getItem(key) ?? newDeviceToken();
      localStorage.setItem(key, token);
      try {
        await postJson("/api/join", { code, name, token });
        router.push(`/session/${code}/player`);
      } catch (reason) {
        setError((reason as Error).message);
      }
    });
  }

  return (
    <form onSubmit={join}>
      <h1>Join the game</h1>
      <label className="field">
        Your name
        {/* The pattern refuses a name made of spaces only. */}
        <input name="name" required pattern=".*\S.*" maxLength={maxNameLength} autoComplete="given-name" />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={joining}>
        Join
      </button>
    </form>
  );
}
