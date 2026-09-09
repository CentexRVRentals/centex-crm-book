import { createClient } from "@supabase/supabase-js";
import { FORBIDDEN_TABLES } from "./contract.js";

// THE ONLY PLACE THIS REPO TALKS TO THE DATABASE.
//
// One client, created once, exported. Not because a second would break
// anything, but because `from()` is wrapped below, and a client created
// elsewhere would slip past the wrapper.

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  // Fail at boot, loudly. The alternative is a site that renders an empty
  // fleet and looks like a data problem, on a deploy where somebody forgot to
  // set the Netlify environment variables.
  throw new Error(
    "VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are not set. " +
    "Locally: .env. On Netlify: Site configuration -> Environment variables, " +
    "then redeploy — Netlify bakes these in at BUILD time, so adding one to an " +
    "existing site does nothing until the next build."
  );
}

// THE ANON KEY IS PUBLIC BY DESIGN. It ships in the bundle; that is what it is
// for. Its whole reach is the five views granted to `anon` — which is why the
// grant audit on the CRM side asserts that list is exactly five and nothing
// more. The service role key must never appear in this repo, in any form,
// including a variable that is never read.
const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ----------------------------------------------------------------------------
// The guard rail.
// ----------------------------------------------------------------------------
// A wrapper that refuses a base table by name. Belt and braces over the RLS
// grant, and it fails LOUDLY at the call site rather than returning a
// permission error that some component quietly renders as an empty list.
//
// The real defence is the grant. This is what turns "silently empty" into "a
// developer sees the mistake immediately", which is the difference between a
// bug found in five minutes and one found by a guest.
export const supabase = {
  from(name) {
    if (FORBIDDEN_TABLES.includes(name)) {
      throw new Error(
        `This site may not read "${name}". It reads five public views and nothing else — ` +
        "see src/lib/contract.js. If you need something that is not there, it has to be " +
        "added to a view in the CRM repo first."
      );
    }
    return client.from(name);
  },
  functions: client.functions,
  storage: client.storage,
};

// ----------------------------------------------------------------------------
// Listing photo URLs.
// ----------------------------------------------------------------------------
// The `unit-listing-photos` bucket was made public in CRM v3.87 precisely so
// this can be a plain CDN URL rather than a signed one with a TTL. A signed URL
// on a listing page would expire while somebody is looking at it.
export function photoUrl(storagePath) {
  if (!storagePath) return null;
  return `${url}/storage/v1/object/public/unit-listing-photos/${storagePath}`;
}
