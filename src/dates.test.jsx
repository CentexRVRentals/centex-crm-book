// @vitest-environment jsdom
//
// b0.3 — THE DATE RULES.
//
// These exist twice: here and in the Edge Function. That is deliberate (CRM
// §4.163) and the risk is exactly one thing — **if this file disagrees with the
// server about which days are bookable, a guest is offered a date and then
// refused it.**
//
// This file tests the rules in isolation, fast and offline.
// conformance.test.jsx tests that they AGREE WITH THE SERVER, and needs the
// network. Both matter and neither replaces the other: a bug that is wrong in
// the same way on both sides passes conformance and fails here.

import { describe, it, expect } from "vitest";
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import DatePicker from "./components/DatePicker.jsx";
import {
  isIsoDate, nightsBetween, addDays, overlapsBusy, busyDaySet,
  checkDates, monthGrid, todayCentral,
  MAX_NIGHTS, MAX_ADVANCE_DAYS, busyRefusal, shortDay, DATES_TAKEN,
} from "./lib/dates.js";

const TODAY = "2026-09-09";
const busy = [{ from: "2026-11-02", through: "2026-11-06" }];

// b0.23 (CRM v6.34, S4 R8 #9) - the SAME ranges and sentences as the CRM's
// booking-request-validation.test.js: the site and the server say one thing.
describe("b0.23 - a refused start day says why", () => {
  // A same-day camper's Nov 2-6 trip, as the view publishes it: Nov 3-5.
  const sameDay = [{ from: "2026-11-03", through: "2026-11-05" }];
  const WHY = "This camper is booked from Tue, Nov 3, so a trip can't start on Mon, Nov 2 — it can end that day. Please pick another start date.";

  it("CRITICAL: the other trip's pick-up day (not greyed) as a start names the day it is booked from", () => {
    expect(busyRefusal("2026-11-02", "2026-11-04", sameDay)).toBe(WHY);
    expect(busyRefusal("2026-11-02", "2026-11-09", sameDay)).toBe(WHY);
    expect(checkDates({ start: "2026-11-02", end: "2026-11-04", busy: sameDay, today: TODAY }).errors).toEqual([WHY]);
  });

  it("CRITICAL: an overlap that crosses a greyed day keeps the plain sentence", () => {
    expect(busyRefusal("2026-10-30", "2026-11-04", sameDay)).toBe(DATES_TAKEN);
    expect(busyRefusal("2026-11-04", "2026-11-08", sameDay)).toBe(DATES_TAKEN);
    // A start day that is itself taken, with another trip from the next day: greyed, so the plain sentence.
    const backToBack = [...sameDay, { from: "2026-11-06", through: "2026-11-08" }];
    expect(busyRefusal("2026-11-05", "2026-11-07", backToBack)).toBe(DATES_TAKEN);
    expect(DATES_TAKEN).toBe("Those dates have just been taken. Please pick another week.");
  });

  it("no overlap, no sentence - ending on that day is fine, and so is starting after the trip", () => {
    expect(busyRefusal("2026-10-30", "2026-11-02", sameDay)).toBe("");
    expect(busyRefusal("2026-11-06", "2026-11-08", sameDay)).toBe("");
    expect(busyRefusal("2026-11-02", "2026-11-04", [])).toBe("");
  });

  it("the day as the guest reads it", () => {
    expect(shortDay("2026-11-02")).toBe("Mon, Nov 2");
    expect(shortDay("2027-01-10")).toBe("Sun, Jan 10");
  });
});

// b0.24 (CRM v6.34, S4 R8 #9) - the sentence where the guest is: the CALENDAR.
// Found live on 09-27: tapping the day before a busy range greyed every later
// day and said "now tap your return day", so b0.23's sentence never showed.
describe("b0.24 - the calendar says why at the first tap", () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const today = todayCentral();
  const start = addDays(today, 20);
  const range = { from: addDays(start, 1), through: addDays(start, 3) };
  const later = addDays(start, 6);

  function mount() {
    function Harness() {
      const [value, setValue] = useState({ start: "", end: "" });
      return <DatePicker listing={{ minimumNights: 1 }} busy={[range]} value={value} onChange={setValue} />;
    }
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<Harness />));
    const day = (iso) => {
      for (let i = 0; i < 3 && !host.querySelector(`button[aria-label="${iso}"]`); i++) {
        act(() => host.querySelector('button[aria-label="Next month"]').click());
      }
      return host.querySelector(`button[aria-label="${iso}"]`);
    };
    return { host, day, done: () => { act(() => root.unmount()); host.remove(); } };
  }

  it("CRITICAL: tapping the day before a busy range shows the server's sentence, not 'now tap your return day'", () => {
    const { host, day, done } = mount();
    const d = day(start);
    expect(d.disabled).toBe(false);
    act(() => d.click());
    expect(host.textContent).toContain(busyRefusal(start, addDays(start, 1), [range]));
    expect(host.textContent).toContain("so a trip can't start on");
    expect(host.textContent).not.toContain("now tap your return day");
    done();
  });

  it("CRITICAL: after that tap a later free day is tappable and starts again", () => {
    const { host, day, done } = mount();
    const first = day(start);
    act(() => first.click());
    const next = day(later);
    expect(next.disabled).toBe(false);
    act(() => next.click());
    expect(host.textContent).toContain("now tap your return day");
    expect(host.textContent).not.toContain("so a trip can't start on");
    // Busy days stay greyed throughout.
    expect(day(range.from).disabled).toBe(true);
    done();
  });

  it("an ordinary start is unchanged: later days past the busy range stay unreachable", () => {
    const { host, day, done } = mount();
    const ordinary = day(addDays(start, -2));
    act(() => ordinary.click());
    expect(host.textContent).toContain("now tap your return day");
    expect(day(start).disabled).toBe(false);
    expect(day(later).disabled).toBe(true);
    done();
  });
});

describe("dates parse the way the database stores them", () => {
  it("CRITICAL: only real YYYY-MM-DD calendar dates", () => {
    expect(isIsoDate("2026-11-02")).toBe(true);
    // The regex alone accepts these. Parsing is what rejects them.
    expect(isIsoDate("2026-02-31")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    for (const junk of ["2026-1-1", "26-01-01", "", null, undefined, 20261102, {}, [], true]) {
      expect(isIsoDate(junk), `${JSON.stringify(junk)} accepted`).toBe(false);
    }
  });

  it("nights, not days", () => {
    // Oct 1 -> Oct 4 is THREE nights. The off-by-one a minimum-nights rule
    // exists to be exact about, and one the server's own test got wrong first
    // time round.
    expect(nightsBetween("2026-10-01", "2026-10-04")).toBe(3);
    expect(nightsBetween("2026-10-01", "2026-10-02")).toBe(1);
    expect(nightsBetween("2026-10-01", "2026-10-01")).toBe(0);
    expect(nightsBetween("bad", "worse")).toBe(0);
  });

  it("addDays crosses months and years", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("CRITICAL: today is CENTRAL, not UTC", () => {
    // A guest in California at 10pm must not be told the 9th is in the past
    // while Texas is still on the 9th. UTC has already rolled over by then.
    const lateInCalifornia = new Date("2026-09-10T04:30:00Z"); // 11:30pm CDT on the 9th
    expect(todayCentral(lateInCalifornia)).toBe("2026-09-09");
  });
});

describe("THE ONE DECISION: a busy range is inclusive at both ends", () => {
  // If this changes and the server does not, a guest is offered a day the
  // server refuses. conformance.test.jsx is what proves they still agree.
  it("CRITICAL: every kind of overlap is an overlap", () => {
    for (const [s, e, why] of [
      ["2026-11-03", "2026-11-05", "wholly inside"],
      ["2026-10-30", "2026-11-03", "straddles the start"],
      ["2026-11-05", "2026-11-09", "straddles the end"],
      ["2026-10-01", "2026-12-01", "wholly contains"],
      ["2026-11-06", "2026-11-09", "starts on the day it ends"],
      ["2026-10-29", "2026-11-02", "ends on the day it starts"],
    ]) {
      expect(overlapsBusy(s, e, busy), `${why} was allowed`).toBe(true);
    }
  });

  it("clear dates are clear", () => {
    expect(overlapsBusy("2026-10-25", "2026-11-01", busy)).toBe(false);
    expect(overlapsBusy("2026-11-07", "2026-11-12", busy)).toBe(false);
    expect(overlapsBusy("2026-11-03", "2026-11-05", [])).toBe(false);
  });

  it("a malformed busy row cannot throw or spin", () => {
    expect(() => overlapsBusy("2026-11-01", "2026-11-03", [null, undefined, {}, { from: 1 }])).not.toThrow();
    // A corrupt range must not expand forever — the view is written by a repo
    // this one cannot see.
    const days = busyDaySet([{ from: "2026-01-01", through: "2099-01-01" }]);
    expect(days.size).toBeLessThanOrEqual(401);
  });

  it("CRITICAL: busyDaySet marks every day of a range, ends included", () => {
    const days = busyDaySet(busy);
    for (const d of ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"]) {
      expect(days.has(d), `${d} not marked busy`).toBe(true);
    }
    expect(days.has("2026-11-01")).toBe(false);
    expect(days.has("2026-11-07")).toBe(false);
  });
});

describe("the verdict", () => {
  const check = (over) => checkDates({
    start: "2026-10-01", end: "2026-10-05", busy, minimumNights: 2, today: TODAY, ...over,
  });

  it("CRITICAL: a good range passes (anti-vacuity)", () => {
    const r = check();
    expect(r.errors, r.errors.join(" / ")).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.nights).toBe(4);
  });

  it("CRITICAL: the past is refused, today is not", () => {
    expect(check({ start: "2026-09-08", end: "2026-09-12" }).ok).toBe(false);
    expect(check({ start: TODAY, end: "2026-09-12" }).ok).toBe(true);
  });

  it("CRITICAL: minimum nights, exactly", () => {
    expect(check({ start: "2026-10-01", end: "2026-10-03", minimumNights: 2 }).ok).toBe(true);
    expect(check({ start: "2026-10-01", end: "2026-10-02", minimumNights: 2 }).ok).toBe(false);
    expect(check({ start: "2026-10-01", end: "2026-10-02", minimumNights: 0 }).ok).toBe(true);
  });

  it("collects every error, not just the first", () => {
    // A guest fixing one field at a time because the page only ever names one
    // is a guest who gives up.
    const r = check({ start: "2026-09-01", end: "2026-09-01" });
    expect(r.errors.length).toBeGreaterThan(1);
  });

  it("ceilings are real, not placeholders", () => {
    expect(MAX_NIGHTS).toBeGreaterThan(7);
    expect(MAX_ADVANCE_DAYS).toBeGreaterThan(90);
    expect(check({ start: "2026-10-01", end: "2027-06-01" }).ok).toBe(false);
    expect(check({ start: "2030-01-01", end: "2030-01-05" }).ok).toBe(false);
  });

  it("hostile input never throws", () => {
    for (const v of [undefined, null, "", 0, 42, true, [], {}, "nonsense"]) {
      expect(() => checkDates({ start: v, end: v, busy: v, minimumNights: v, today: TODAY })).not.toThrow();
    }
  });
});

// b0.13 - "the estimate is an estimate" RETIRED with estimate() itself. The
// server prices the stay now (quote.test.jsx); what replaces these two tests
// is the rule that this site does no arithmetic on money:
describe("the calendar prices nothing (b0.13)", () => {
  it("CRITICAL: dates.js and the date picker carry no price arithmetic", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dates = await import("./lib/dates.js");
    expect(dates).not.toHaveProperty("estimate");
    const picker = fs.readFileSync(path.join(process.cwd(), "src/components/DatePicker.jsx"), "utf8");
    expect(picker).not.toMatch(/money\(|pricePerNight|Estimate/);
  });
});

describe("the calendar grid", () => {
  it("42 cells, Sunday first, neighbours filled in", () => {
    const cells = monthGrid(2026, 10); // November 2026
    expect(cells).toHaveLength(42);
    expect(cells.filter((c) => c.inMonth)).toHaveLength(30);
    expect(cells[0].iso <= "2026-11-01").toBe(true);
    // No gaps: every cell is one day after the last.
    for (let i = 1; i < cells.length; i++) {
      expect(cells[i].iso).toBe(addDays(cells[i - 1].iso, 1));
    }
  });

  it("February in a leap year", () => {
    expect(monthGrid(2028, 1).filter((c) => c.inMonth)).toHaveLength(29);
  });
});
