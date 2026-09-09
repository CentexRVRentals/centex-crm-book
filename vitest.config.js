import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// environment: "jsdom" GLOBALLY, which is the opposite of the CRM's choice.
//
// The CRM defaults to `node` because almost every one of its 175 test files
// reads source text rather than rendering anything, and the two that do render
// declare `// @vitest-environment jsdom` on their first line. Making jsdom the
// default there would slow 173 files down for the benefit of two — and the one
// time a container set it globally, a test passed on that machine and failed
// on the real one.
//
// This repo is the opposite shape: it is nothing but components. jsdom is the
// right default here for the same reason `node` is right there.
//
// .test.jsx AS WELL AS .test.js, and the react plugin, because a test that
// renders a component is easier to read in JSX — and the alternative,
// React.createElement everywhere, is the kind of friction that ends with
// somebody not writing the test.
export default defineConfig({
  plugins: [react()],
  // The same injection vite.config.js does. Without it every component that
  // shows the version throws ReferenceError under test — which is a real
  // failure mode worth having the harness share rather than special-case.
  define: {
    __APP_VERSION__: JSON.stringify("test"),
    __BUILD_TIME__: JSON.stringify("0000-00-00 00:00"),
  },
  test: {
    environment: "jsdom",
    // Sets IS_REACT_ACT_ENVIRONMENT. Without it every rendering test throws
    // "The current testing environment is not configured to support act(...)"
    // — and the console.error mocks in the render suites hide the warning that
    // precedes it, so it can pass on one machine and fail on another.
    setupFiles: ["./src/test-setup.js"],
    include: ["src/**/*.test.{js,jsx}"],
    // 30s, not the 5s default. The hostile-data cases render every column as
    // every wrong type — hundreds of mounts in one `it`.
    //
    // THIS IS A MARGIN, NOT THE FIX. The real problem was a helper that never
    // unmounted, so each render made the next one slower; that is fixed in
    // browse.test.jsx. This exists so a correct test does not fail on a slower
    // machine than the one it was written on, which has already happened once.
    testTimeout: 30000,
  },
});
