# centex-crm-book - context manifest

Generated 2026-09-09 19:27 local by refresh-context.ps1.

**Everything in this upload was current as of the commit below.** If a session
is reading one of these files and the repo has since moved on, this is how it
finds out.

| | |
|---|---|
| Version | `b0.8.0` (package.json - injected into the site header at build) |
| Branch | `main` |
| Commit | `af94780` |
| Working tree | **DIRTY** - uncommitted changes, so these files may not match the commit |
| Repo | `C:\dev\centex-crm-book` |
| Deployed | https://centex-crm-book.netlify.app/ |
| Supabase | `https://benkchokxjhgbrtotqdq.supabase.co` |

## Everything is prefixed book-

So it cannot be confused with the CRM repo's files, which have the same names
and different rules.

**This repo: LF line endings, two gates, jsdom, bN.N versions.**
**The CRM: CRLF, three gates, node, N.NN versions.**

## Files in this upload

| Uploaded as | Repo path | Lines |
|---|---|---|
| `book-HANDOVER.md` | `HANDOVER.md` | 204 |
| `book-contract.js` | `src\lib\contract.js` | 125 |
| `book-App.jsx` | `src\App.jsx` | 26 |
| `book-main.jsx` | `src\main.jsx` | 9 |
| `book-supabase.js` | `src\lib\supabase.js` | 68 |
| `book-listings.js` | `src\lib\listings.js` | 226 |
| `book-dates.js` | `src\lib\dates.js` | 169 |
| `book-request.js` | `src\lib\request.js` | 121 |
| `book-meta.js` | `src\lib\meta.js` | 103 |
| `book-Listings.jsx` | `src\pages\Listings.jsx` | 90 |
| `book-Camper.jsx` | `src\pages\Camper.jsx` | 297 |
| `book-Requested.jsx` | `src\pages\Requested.jsx` | 61 |
| `book-States.jsx` | `src\components\States.jsx` | 92 |
| `book-DatePicker.jsx` | `src\components\DatePicker.jsx` | 154 |
| `book-RequestForm.jsx` | `src\components\RequestForm.jsx` | 182 |
| `book-theme.css` | `src\theme.css` | 167 |
| `book-contract-script.txt` | `scripts\contract.mjs` | 156 |
| `book-conformance-script.txt` | `scripts\conformance.mjs` | 209 |
| `book-check-bundle-script.txt` | `scripts\check-bundle.mjs` | 106 |
| `book-vite.config.js` | `vite.config.js` | 25 |
| `book-vitest.config.js` | `vitest.config.js` | 46 |
| `book-eslint.config.js` | `eslint.config.js` | 49 |
| `book-index.html` | `index.html` | 33 |
| `book-netlify-redirects.txt` | `public\_redirects` | 5 |
| `book-robots.txt` | `public\robots.txt` | 10 |

## NOT uploaded - ask for these by name if a release needs one

### Test files (6)

- `src/browse.test.jsx`
- `src/contract-offline.test.js`
- `src/dates.test.jsx`
- `src/meta.test.jsx`
- `src/request.test.jsx`
- `src/version.test.jsx`

### Deliberately excluded

- .env - the anon key is public by design, but a credentials file does not belong in a document store
- node_modules, dist, package-lock.json

## Gates in this repo

    npm run preship      eslint src/ scripts/ && vitest run     (offline, fast)
    npm run build        sitemap -> vite build -> check-bundle  (verifies its own output)
    npm run contract     five live views + the Edge Function    (needs network)
    npm run conformance  this repo's date rules vs the live     (needs network)
                         request-booking dryRun

contract and conformance are NOT in preship, deliberately: a gate that fails
when the wifi drops is a gate people learn to ignore. Both are required steps
in every delivery script.

