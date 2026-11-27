"use client";

import { useEffect, useState } from "react";

/** Counts down to a moment the server chose. Each snapshot restarts it from the time the server says is left. */
export function Countdown({ startsInMs }: { startsInMs: number }) {
  const [seconds, setSeconds] = useState(Math.ceil(startsInMs / 1000));

  useEffect(() => {
    const end = Date.now() + startsInMs;
    const timer = setInterval(() => setSeconds(Math.max(0, Math.ceil((end - Date.now()) / 1000))), 100);
    return () => clearInterval(timer);
  }, [startsInMs]);

  return (
    <p className="countdown" data-testid="countdown" aria-live="polite">
      {seconds}
    </p>
  );
}
