// Runs before every test file. Wired in vitest.config.js as `setupFiles`.
//
// ============================================================================
// WHY THIS EXISTS
// ============================================================================
// React's `act()` refuses to run unless this global says it is in a test
// environment. Vitest does not set it — jsdom or not — so without this line
// every test that renders throws:
//
//     The current testing environment is not configured to support act(...)
//
// IT DID NOT THROW IN THE CONTAINER THESE TESTS WERE WRITTEN IN. React warns
// through console.error before it throws, and browse.test.jsx and
// request.test.jsx both mock console.error to silence the ~800 warnings the
// hostile-data cases produce. That mock was hiding the one warning that
// mattered.
//
// §4.159 for the third time: green because of the machine, not the code. The
// fix is not to un-mock console.error — the noise is real and mocking it is
// right — it is to set the flag the machine was supposed to have.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
