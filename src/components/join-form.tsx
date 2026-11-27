"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { postJson } from "@/lib/api-client";
import { joinableRoles, normalizeCode, roleLabels, tokenKey } from "@/lib/protocol";

// getRandomValues also works on a plain http address, where randomUUID does not.
const newDeviceToken = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");

export function JoinForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [joining, startJoining] = useTransition();

  function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const code = normalizeCode(String(form.get("code")));
    const role = String(form.get("role"));
    setError("");
    // Stays pending until the station page is showing, so a second tap cannot join twice.
    startJoining(async () => {
      // Saved before sending: if the reply is lost, the next try asks for the same seat with the same token.
      const key = tokenKey(code, role);
      const token = localStorage.getItem(key) ?? newDeviceToken();
      localStorage.setItem(key, token);
      try {
        await postJson("/api/join", { code, role, token });
        router.push(`/session/${code}/${role}`);
      } catch (reason) {
        setError((reason as Error).message);
      }
    });
  }

  return (
    <form onSubmit={join}>
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
      <fieldset>
        <legend>This device is</legend>
        {joinableRoles.map((role) => (
          <label key={role} className="choice">
            <input type="radio" name="role" value={role} required />
            {roleLabels[role]}
          </label>
        ))}
      </fieldset>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={joining}>
        Join
      </button>
    </form>
  );
}
