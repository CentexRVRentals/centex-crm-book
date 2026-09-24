// @vitest-environment jsdom
//
// b0.4 — THE REQUEST PATH.
//
// This is the only write this site makes, and everything it sends goes to an
// endpoint deployed --no-verify-jwt. The server validates all of it again — so
// what is tested here is not "does the server accept this", which
// conformance.mjs and the CRM's own suite cover, but the things only this side
// can get wrong:
//
//   * losing the honeypot field, which nothing else would notice
//   * paraphrasing a server refusal into a second, different reason
//   * sending a status, a price, or anything else the server does not want
//   * a double tap making two holds
//   * rendering a confirmation that reads like a booking

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

import { MemoryRouter, Routes, Route } from "react-router-dom";
import { buildPayload, requestBooking } from "./lib/request.js";
import { FUNCTIONS } from "./lib/contract.js";
import { addDays, todayCentral } from "./lib/dates.js";
import RequestForm from "./components/RequestForm.jsx";
import Requested from "./pages/Requested.jsx";

const LISTING = {
  unitId: "u1", name: "Igloo", pricePerNight: 109, minimumNights: 2,
  deliveryDollarMile: 3, deliveryMilesMax: 100, prepFee: 75,
};
// NEAR-FUTURE, not 2099. The first version used 2099 and every submit was
// refused with "That's further ahead than we're booking right now" — the
// MAX_ADVANCE_DAYS rule, working correctly, against a fixture that ignored it.
// Derived from today so the file does not expire.
const soon = (n) => addDays(todayCentral(), n);
const DATES = { start: soon(30), end: soon(34) };
const BUSY = [{ from: soon(90), through: soon(97) }];

async function mount(ui) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const swallow = (e) => e.preventDefault();
  window.addEventListener("error", swallow);
  let html = "";
  try {
    act(() => { root.render(ui); });
    await act(async () => { await Promise.resolve(); });
    html = host.innerHTML;
  } finally {
    window.removeEventListener("error", swallow);
  }
  // The host stays mounted so a test can click; each test tears it down.
  return { host, root, html: () => host.innerHTML, cleanup: () => { act(() => root.unmount()); host.remove(); } };
}

function type(host, labelText, value) {
  const label = [...host.querySelectorAll("label")].find((l) => l.textContent.startsWith(labelText));
  const input = label?.querySelector("input, textarea");
  if (!input) throw new Error(`no field labelled ${labelText}`);
  const setter = Object.getOwnPropertyDescriptor(
    input.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,
    "value"
  ).set;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
}

const clickButton = (host, text) => {
  const b = [...host.querySelectorAll("button")].find((x) => x.textContent.trim() === text);
  if (!b) throw new Error(`no button "${text}"`);
  act(() => { b.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  return b;
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  // request.js reads import.meta.env at call time. Stubbed HERE rather than
  // baked into vitest.config, so a test that needs to see the "not set" branch
  // can unstub — and so the config does not carry a fake key that would mask a
  // genuinely missing variable.
  vi.stubEnv("VITE_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-anon-key");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

// ----------------------------------------------------------------------------

describe("the payload", () => {
  const build = (over = {}) => buildPayload({
    unitId: "u1",
    dates: DATES,
    guest: { name: "Jane", email: "j@example.com", phone: "5125550100", guests: "4", notes: "", company: "" },
    delivery: { wanted: false, address: "", city: "", state: "", zip: "" },
    ...over,
  });

  it("CRITICAL: every field the contract names is sent, even when blank", () => {
    // A missing key and an empty one are the same to the server — but a
    // missing key is how a field silently stops being sent, and the honeypot
    // is the field that would go first.
    const p = build();
    for (const k of FUNCTIONS["request-booking"].sends) {
      expect(k in p, `payload is missing "${k}"`).toBe(true);
    }
  });

  it("CRITICAL: the honeypot field is always present", () => {
    expect(build()).toHaveProperty("company");
    expect(build().company).toBe("");
  });

  it("CRITICAL: no status, no price, nothing the server does not want", () => {
    // The server ignores extras, but sending them is how somebody later
    // decides the client can influence them.
    const p = build();
    for (const forbidden of ["status", "total", "rental_amount", "price", "reservationNum", "held_at", "dryRun"]) {
      expect(p, `payload carries "${forbidden}"`).not.toHaveProperty(forbidden);
    }
  });

  it("pickup sends no address; delivery sends the one given", () => {
    const p = build();
    expect(p.method).toBe("pickup");
    expect(p.address).toBe("");
    const d = build({ delivery: { wanted: true, address: "1 Main St", city: "Kyle", state: "TX", zip: "78640" } });
    expect(d.method).toBe("delivery");
    expect(d.address).toBe("1 Main St");
    expect(d.zip).toBe("78640");
  });
});

describe("what comes back", () => {
  const stub = (status, body) =>
    vi.stubGlobal("fetch", vi.fn(async () => ({
      status, ok: status < 400, json: async () => body,
    })));

  it("CRITICAL: a refusal is passed through WORD FOR WORD", async () => {
    // Those sentences were written to be read by a guest. Rewriting them here
    // means two different reasons exist for one refusal.
    const sent = ["This camper has a 2-night minimum.", "That start date is in the past."];
    stub(400, { ok: false, errors: sent });
    const r = await requestBooking({});
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual(sent);
  });

  it("CRITICAL: a 401 is named as a deploy mistake, not shown as a guest error", async () => {
    // 401 means --no-verify-jwt was missed. Without this it would present as
    // "something went wrong" forever, on every request, for everyone.
    stub(401, {});
    const r = await requestBooking({});
    expect(r.misconfigured).toBe(true);
    expect(r.errors[0]).toMatch(/call us/i);
  });

  it("CRITICAL: a network failure says so, and does not read as a refusal", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const r = await requestBooking({});
    expect(r.unreached).toBe(true);
    expect(r.errors[0]).toMatch(/connection/i);
  });

  it("CRITICAL: ok:false with no errors still gives the guest a sentence", async () => {
    stub(400, { ok: false });
    const r = await requestBooking({});
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("an unreadable body is not treated as success", async () => {
    stub(200, "not json at all");
    const r = await requestBooking({});
    expect(r.ok).toBe(false);
  });

  it("a duplicate is reported as one", async () => {
    stub(200, { ok: true, reservationNum: "WEB-260909-ABCD", duplicate: true });
    const r = await requestBooking({});
    expect(r).toMatchObject({ ok: true, reservationNum: "WEB-260909-ABCD", duplicate: true });
  });
});

describe("the form", () => {
  const form = (over = {}) => (
    <MemoryRouter>
      <RequestForm listing={LISTING} busy={BUSY} dates={DATES} onCancel={() => {}} {...over} />
    </MemoryRouter>
  );

  it("CRITICAL: it renders and says it is not a booking (anti-vacuity)", async () => {
    const m = await mount(form());
    expect(m.html()).toMatch(/isn't a booking yet/i);
    m.cleanup();
  });

  it("CRITICAL: the honeypot is in the DOM, hidden, and out of the tab order", async () => {
    // Hidden with CSS, not type="hidden" — a hidden input is the one thing a
    // bot knows to leave alone.
    const m = await mount(form());
    const hp = m.host.querySelector(".hp input");
    expect(hp, "the honeypot field is gone").toBeTruthy();
    expect(hp.getAttribute("type")).not.toBe("hidden");
    expect(hp.tabIndex).toBe(-1);
    expect(m.host.querySelector(".hp").getAttribute("aria-hidden")).toBe("true");
    m.cleanup();
  });

  it("CRITICAL: a missing name is refused BEFORE the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const m = await mount(form());
    clickButton(m.host, "Send request");
    await act(async () => { await Promise.resolve(); });
    // b0.13 - the quote box's own calls (quote:true) are not the request.
    expect(fetchSpy.mock.calls.filter((c) => JSON.parse(c[1].body).quote !== true)).toEqual([]);
    expect(m.host.textContent).toMatch(/name we can put on the reservation/i);
    m.cleanup();
  });

  it("CRITICAL: neither email nor phone is refused before the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const m = await mount(form());
    type(m.host, "Your name", "Jane Doe");
    clickButton(m.host, "Send request");
    await act(async () => { await Promise.resolve(); });
    // b0.13 - the quote box's own calls (quote:true) are not the request.
    expect(fetchSpy.mock.calls.filter((c) => JSON.parse(c[1].body).quote !== true)).toEqual([]);
    expect(m.host.textContent).toMatch(/email address or a phone number/i);
    m.cleanup();
  });

  it("CRITICAL: a valid request sends the honeypot field along with the rest", async () => {
    let sent = null;
    vi.stubGlobal("fetch", vi.fn(async (_url, opts) => {
      // b0.13 - the form's quote box asks the same function with quote:true
      // (after its debounce). Those are not the request; ignore them, so a
      // slow machine cannot make this test read a quote body as the request.
      if (JSON.parse(opts.body).quote === true) return { status: 400, json: async () => ({ ok: false, quote: true, errors: ["x"] }) };
      sent = JSON.parse(opts.body);
      return { status: 200, ok: true, json: async () => ({ ok: true, reservationNum: "WEB-1" }) };
    }));
    const m = await mount(form());
    type(m.host, "Your name", "Jane Doe");
    type(m.host, "Email", "jane@example.com");
    clickButton(m.host, "Send request");
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(sent, "nothing was sent").toBeTruthy();
    expect(sent.name).toBe("Jane Doe");
    expect(sent).toHaveProperty("company");
    expect(sent.start).toBe(DATES.start);
    expect(sent.unitId).toBe("u1");
    // b0.13 - and the add-ons go as an array, never the blank-filled "".
    expect(sent.addons).toEqual([]);
    m.cleanup();
  });

  it("CRITICAL: a second tap while sending does not send twice", async () => {
    // The server is idempotent for an identical repost, so this is about the
    // guest not wondering whether the first tap worked — but two requests in
    // flight is still two requests.
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url, opts) => {
      // b0.13 - quote calls (quote:true) are not requests; see above.
      if (JSON.parse(opts.body).quote === true) return { status: 400, json: async () => ({ ok: false, quote: true, errors: ["x"] }) };
      calls++;
      await new Promise((r) => setTimeout(r, 30));
      return { status: 200, ok: true, json: async () => ({ ok: true, reservationNum: "WEB-1" }) };
    }));
    const m = await mount(form());
    type(m.host, "Your name", "Jane Doe");
    type(m.host, "Email", "jane@example.com");
    clickButton(m.host, "Send request");
    // Flush so React has re-rendered the button into its in-flight state
    // before it is queried. Without this the test asks for a label the DOM
    // has not been given yet.
    await act(async () => { await Promise.resolve(); });
    // The button relabels and disables while in flight. A second tap on it now
    // must not start a second request.
    clickButton(m.host, "Sending…");
    await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
    expect(calls).toBe(1);
    m.cleanup();
  });

  it("CRITICAL: a server refusal is RENDERED word for word", async () => {
    // The lib passes the sentences through; this checks the form SHOWS them.
    // Without this case, replacing `setErrors(result.errors)` with a generic
    // "Something went wrong. Please try again." passes the whole suite — which
    // it did, the first time this mutation was tried. The lib test proved the
    // sentences arrive; nothing proved they reach the screen.
    const sent = "This camper has a 2-night minimum.";
    vi.stubGlobal("fetch", vi.fn(async () => ({
      status: 400, ok: false, json: async () => ({ ok: false, errors: [sent] }),
    })));
    const m = await mount(form());
    type(m.host, "Your name", "Jane Doe");
    type(m.host, "Email", "jane@example.com");
    clickButton(m.host, "Send request");
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(m.host.textContent).toContain(sent);
    m.cleanup();
  });

  it("delivery fields only appear when delivery is chosen", async () => {
    const m = await mount(form());
    expect(m.host.textContent).not.toMatch(/Delivery address/);
    const box = m.host.querySelector('input[type="checkbox"]');
    act(() => { box.click(); });
    expect(m.host.textContent).toMatch(/Delivery address/);
    // b0.13 RE-POINTED. This asserted "We'll work out the delivery fee and
    // include it when we come back to you" - the promise that the fee was
    // NOT quoted. CRM decision 5 (09-23) replaced it: the quote box shows
    // delivery as "from $minimum - we'll confirm the delivery price", priced
    // by the server (quote.test.jsx drives that). What stays true, and is
    // held here: no distance is calculated on this page, and the old promise
    // is gone rather than contradicting the quote beside it.
    expect(m.host.textContent).not.toMatch(/work out the delivery fee/i);
    expect(m.host.textContent).not.toMatch(/per mile|\/mile/i);
    m.cleanup();
  });

  it("a camper with no delivery pricing offers no delivery", async () => {
    const m = await mount(form({ listing: { ...LISTING, deliveryDollarMile: null } }));
    expect(m.host.querySelector('input[type="checkbox"]')).toBeNull();
    m.cleanup();
  });
});

describe("the confirmation", () => {
  const page = (num, state) => (
    <MemoryRouter initialEntries={[{ pathname: `/requested/${num}`, state }]}>
      <Routes><Route path="/requested/:reservationNum" element={<Requested />} /></Routes>
    </MemoryRouter>
  );

  it("CRITICAL: it does NOT say booked or confirmed", async () => {
    // A guest who believes they have a camper and turns up is a worse outcome
    // than one who is unsure.
    const m = await mount(page("WEB-260909-ABCD", { camper: "Igloo" }));
    const t = m.host.textContent;
    expect(t).toContain("WEB-260909-ABCD");
    expect(t).toMatch(/Nothing is booked yet/i);
    expect(t).not.toMatch(/\bconfirmed\b/i);
    m.cleanup();
  });

  it("CRITICAL: it reads correctly after a refresh, with no router state", async () => {
    // State is lost on reload. The reservation number is in the URL precisely
    // because it is the part that matters.
    const m = await mount(page("WEB-260909-ABCD", undefined));
    expect(m.host.textContent).toContain("WEB-260909-ABCD");
    expect(m.host.textContent).toMatch(/Nothing is booked yet/i);
    m.cleanup();
  });

  it("a duplicate says so, so nobody thinks they sent two", async () => {
    const m = await mount(page("WEB-1", { duplicate: true }));
    expect(m.host.textContent).toMatch(/same request, not a second one/i);
    m.cleanup();
  });
});
