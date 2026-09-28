import React, { useEffect, useRef, useState } from "react";
import {
  AGREEMENT_WORDS as W, INITIALS_CHOICES, checkSigned, openSignedCopy, signingEvent, signingLink, startSigning,
} from "../lib/agreement.js";

// b0.25 (CRM v6.40) - THE SIGNING STEP (lib/agreement.js). b0.26 - after the
// payment: on /paid, the pay page and /sign. `after` words it as the step that
// follows a payment ("One more step").
//
//   choose    the guest picks how to initial (and gives an email if we have none)
//   opening   the CRM builds the PDF and sends it to BoldSign
//   signing   BoldSign's signing window, in the page
//   checking  BoldSign said signed: the page asks the CRM until it agrees
//   declined / failed / slow   said so, with a way to start again
//
// Only the CRM saying signed: true moves the page on to payment (onSigned).

export const LINK_TRIES = 5;
export const CHECK_TRIES = 20;
export const WAIT_MS = 2000;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export default function AgreementStep({ token, agreement, onSigned, waitMs = WAIT_MS, after = false }) {
  const heading = after ? W.afterHeading : W.heading;
  const [phase, setPhase] = useState("choose");
  const [initials, setInitials] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);

  // BoldSign's window (and our own ?signed=1 page inside it) says when it is done.
  useEffect(() => {
    if (phase !== "signing") return undefined;
    const onMessage = (event) => {
      const said = signingEvent(event, window.location.origin);
      if (said === "signed") confirm();
      else if (said === "declined" || said === "failed") setPhase(said);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [phase]);

  async function confirm() {
    setPhase("checking");
    for (let i = 0; i < CHECK_TRIES; i += 1) {
      const r = await checkSigned(token);
      if (!live.current) return;
      if (r.signed) { onSigned({ hasCopy: r.hasCopy }); return; }
      await wait(waitMs);
    }
    if (live.current) setPhase("slow");
  }

  async function open() {
    if (!initials || phase === "opening") return;
    setPhase("opening");
    setError("");
    let r = await startSigning(token, initials, agreement.emailOnFile ? "" : email);
    for (let i = 0; r.ok && r.pending && i < LINK_TRIES; i += 1) {
      await wait(waitMs);
      if (!live.current) return;
      r = await signingLink(token);
    }
    if (!live.current) return;
    if (!r.ok) { setError(r.error); setPhase("choose"); return; }
    if (r.signed) { onSigned({ hasCopy: true }); return; }
    if (r.pending) { setError(W.slow); setPhase("choose"); return; }
    setLink(r.signLink);
    setPhase("signing");
  }

  if (!agreement.ready) {
    return (
      <section className="agreement" aria-label={heading}>
        <h2>{heading}</h2>
        <p className="cal-errors" role="alert">{W.notReady}</p>
      </section>
    );
  }

  return (
    <section className="agreement" aria-label={heading}>
      <h2>{heading}</h2>
      {phase === "signing" ? (
        <iframe className="agreement-frame" title="Rental agreement" src={link} allow="fullscreen" />
      ) : phase === "checking" ? (
        <p className="confirming" aria-live="polite">{W.checking}</p>
      ) : phase === "slow" ? (
        <p className="cal-errors" role="alert">{W.slow}</p>
      ) : (
        <>
          <p className="card-meta">{after ? W.afterIntro : W.intro}</p>
          {phase === "declined" || phase === "failed" ? <p className="cal-errors" role="alert">{W[phase]}</p> : null}
          {!agreement.emailOnFile ? (
            <label className="field">
              <span>{W.emailLabel}</span>
              <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label={W.emailLabel} />
              <span className="card-meta">{W.emailHint}</span>
            </label>
          ) : null}
          <fieldset className="choices" disabled={phase === "opening"}>
            <legend className="sr">How would you like to initial the pages?</legend>
            {INITIALS_CHOICES.map((c) => (
              <label key={c.key} className={`choice${initials === c.key ? " on" : ""}`}>
                <input type="radio" name="initials" value={c.key} checked={initials === c.key} onChange={() => setInitials(c.key)} />
                <span className="choice-body">
                  <span className="choice-head"><strong>{c.title}</strong></span>
                  <span className="card-meta">{c.detail}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {error ? <p className="cal-errors" role="alert">{error}</p> : null}
          <div className="actions">
            <button className="btn" onClick={open} disabled={!initials || phase === "opening" || (!agreement.emailOnFile && !email.trim())}>
              {phase === "opening" ? W.opening : W.open}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

// "View your signed rental agreement" - a fresh 10-minute link, asked for at
// the tap so a page left open never offers a dead one. b0.26 - the window is
// opened AT the tap (openSignedCopy), or a browser blocks it.
export function SignedCopyLink({ token }) {
  const [error, setError] = useState("");
  async function view() {
    setError("");
    const r = await openSignedCopy(token);
    if (!r.ok) setError(r.error);
  }
  return (
    <>
      <button type="button" className="linklike" onClick={view}>{W.copy}</button>
      {error ? <span className="cal-errors" role="alert"> {error}</span> : null}
    </>
  );
}
