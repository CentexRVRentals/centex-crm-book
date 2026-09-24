// @vitest-environment jsdom
//
// b0.14 — ADDRESS SUGGESTIONS. The one outside service this site calls.
// Suggestions only: the server prices distance with its own token, so what
// is tested here is that the list is honest (four real parts or nothing),
// quiet when it should be (no token, too short, offline), and that choosing
// one fills the form and prices the delivery.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { parseFeature, suggestAddresses, SEARCH_NEAR, SUGGEST_DEBOUNCE_MS } from "./lib/address.js";
import { ADDRESS_DEBOUNCE_MS } from "./lib/quote.js";
import { addDays, todayCentral } from "./lib/dates.js";
import RequestForm from "./components/RequestForm.jsx";

const FEATURE = {
  address: "285", text: "Cold Spring Road",
  context: [
    { id: "postcode.1", text: "78610" }, { id: "place.2", text: "Buda" },
    { id: "region.3", text: "Texas", short_code: "US-TX" }, { id: "country.4", text: "United States" },
  ],
};
const ok = (body) => ({ ok: true, status: 200, json: async () => body });

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("parseFeature", () => {
  it("CRITICAL: a Mapbox address becomes the form's four fields", () => {
    expect(parseFeature(FEATURE)).toEqual({
      label: "285 Cold Spring Road, Buda, TX 78610", address: "285 Cold Spring Road", city: "Buda", state: "TX", zip: "78610",
    });
  });
  it("CRITICAL: missing any part is no suggestion - never a three-quarter address", () => {
    expect(parseFeature({ ...FEATURE, address: undefined })).toBeNull();
    for (const drop of ["postcode.", "place.", "region."]) {
      expect(parseFeature({ ...FEATURE, context: FEATURE.context.filter((c) => !c.id.startsWith(drop)) }), drop).toBeNull();
    }
    for (const junk of [null, 7, "x", {}, { context: "no" }]) expect(parseFeature(junk)).toBeNull();
  });
  it("a region with no short code falls back to its name", () => {
    const ctx = FEATURE.context.map((c) => (c.id.startsWith("region.") ? { id: c.id, text: "Texas" } : c));
    expect(parseFeature({ ...FEATURE, context: ctx }).state).toBe("Texas");
  });
});

describe("suggestAddresses", () => {
  it("CRITICAL: no token, no call - and no list", async () => {
    vi.stubEnv("VITE_MAPBOX_TOKEN", "");
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    expect(await suggestAddresses("285 Cold Spring")).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
  it("CRITICAL: asks for US ADDRESSES near the yards, with the site's own token", async () => {
    vi.stubEnv("VITE_MAPBOX_TOKEN", "pk.test-token");
    const spy = vi.fn(async () => ok({ features: [FEATURE, { text: "half" }] }));
    vi.stubGlobal("fetch", spy);
    const got = await suggestAddresses("285 Cold Spring");
    expect(got.map((g) => g.label)).toEqual(["285 Cold Spring Road, Buda, TX 78610"]);
    const url = new URL(spy.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe("https://api.mapbox.com/geocoding/v5/mapbox.places/285%20Cold%20Spring.json");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      access_token: "pk.test-token", autocomplete: "true", country: "US", types: "address", limit: "5",
      proximity: `${SEARCH_NEAR[0]},${SEARCH_NEAR[1]}`,
    });
  });
  it("too short, offline, a bad status or a bad body is an empty list, never a throw", async () => {
    vi.stubEnv("VITE_MAPBOX_TOKEN", "pk.test-token");
    const spy = vi.fn(async () => ok({}));
    vi.stubGlobal("fetch", spy);
    expect(await suggestAddresses("28")).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    expect(await suggestAddresses("285 Cold")).toEqual([]);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ features: [FEATURE] }) })));
    expect(await suggestAddresses("285 Cold")).toEqual([]);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    expect(await suggestAddresses("285 Cold")).toEqual([]);
  });
});

describe("the delivery form", () => {
  const soon = (n) => addDays(todayCentral(), n);
  const LISTING = { unitId: "u1", name: "Charlie", pricePerNight: 99, minimumNights: 2, deliveryDollarMile: 6.5, deliveryMilesMax: 75 };
  const QUOTE = { ok: true, quote: true, lines: [{ kind: "rental", label: "Rental", addonId: null, quantity: 1, nights: 2, unitPriceCents: 9900, amountCents: 19800 }], subtotalCents: 19800, taxCents: 0, totalCents: 19800, estimate: false };

  async function mountForm() {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => { root.render(<MemoryRouter><RequestForm listing={LISTING} busy={[]} dates={{ start: soon(30), end: soon(32) }} addons={[]} onCancel={() => {}} /></MemoryRouter>); });
    await act(async () => { await Promise.resolve(); });
    return { host, cleanup: () => { act(() => root.unmount()); host.remove(); } };
  }
  const typeInto = (host, label, value) => {
    const input = [...host.querySelectorAll("label")].find((l) => l.textContent.startsWith(label)).querySelector("input");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    act(() => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
  };
  const flush = async (ms) => { await act(async () => { vi.advanceTimersByTime(ms); }); await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); }); };

  it("CRITICAL: typing shows suggestions; choosing one fills all four boxes and prices delivery to it", async () => {
    vi.stubEnv("VITE_MAPBOX_TOKEN", "pk.test-token");
    vi.useFakeTimers();
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url, opts) => {
      calls.push({ url: String(url), body: opts?.body ? JSON.parse(opts.body) : null });
      return String(url).startsWith("https://api.mapbox.com") ? ok({ features: [FEATURE] }) : ok(QUOTE);
    }));
    const m = await mountForm();
    act(() => { m.host.querySelector('input[type="checkbox"]').click(); });
    typeInto(m.host, "Delivery address", "285 Cold Spr");
    await flush(SUGGEST_DEBOUNCE_MS);
    const option = [...m.host.querySelectorAll(".addr-suggest button")];
    expect(option.map((b) => b.textContent)).toEqual(["285 Cold Spring Road, Buda, TX 78610"]);
    act(() => { option[0].click(); });
    const value = (label) => [...m.host.querySelectorAll("label")].find((l) => l.textContent.startsWith(label)).querySelector("input").value;
    expect([value("Delivery address"), value("City"), value("State"), value("ZIP")]).toEqual(["285 Cold Spring Road", "Buda", "TX", "78610"]);
    // The list goes away and does not come straight back for the chosen line.
    await flush(SUGGEST_DEBOUNCE_MS);
    expect(m.host.querySelector(".addr-suggest")).toBeNull();
    // The quote is asked for delivery TO that address.
    await flush(ADDRESS_DEBOUNCE_MS);
    const priced = calls.filter((c) => c.body?.quote && c.body.address);
    expect(priced.at(-1).body).toMatchObject({ method: "delivery", address: "285 Cold Spring Road", city: "Buda", state: "TX", zip: "78610" });
    m.cleanup();
  });

  it("CRITICAL: with no token the form is exactly as before - no list, no Mapbox call", async () => {
    vi.stubEnv("VITE_MAPBOX_TOKEN", "");
    vi.useFakeTimers();
    const spy = vi.fn(async () => ok(QUOTE));
    vi.stubGlobal("fetch", spy);
    const m = await mountForm();
    act(() => { m.host.querySelector('input[type="checkbox"]').click(); });
    typeInto(m.host, "Delivery address", "285 Cold Spr");
    await flush(ADDRESS_DEBOUNCE_MS);
    expect(m.host.querySelector(".addr-suggest")).toBeNull();
    expect(spy.mock.calls.some((c) => String(c[0]).includes("mapbox"))).toBe(false);
    m.cleanup();
  });
});
