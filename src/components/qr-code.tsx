"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

/** The QR code for a session's join page, with the link and short code kept readable as a fallback. */
export function JoinPanel({ code }: { code: string }) {
  const [qr, setQr] = useState<{ url: string; svg: string }>();

  useEffect(() => {
    // Built from the address the display was opened at, so a venue display points guests at the public site.
    const url = `${location.origin}/join/${code}`;
    QRCode.toString(url, { type: "svg", margin: 2 }).then((svg) => setQr({ url, svg }), console.error);
  }, [code]);

  return (
    <section className="join-panel" aria-label="Join">
      <p className="eyebrow">Scan to play</p>
      {qr && (
        // The markup comes from our own encoder, never from user input.
        <div className="qr" role="img" aria-label="QR code to join" data-url={qr.url} dangerouslySetInnerHTML={{ __html: qr.svg }} />
      )}
      {qr && <a href={qr.url} data-testid="join-url">{qr.url}</a>}
      <p className="code">
        <span className="eyebrow">Join code</span>
        <strong data-testid="join-code">{code}</strong>
      </p>
    </section>
  );
}
