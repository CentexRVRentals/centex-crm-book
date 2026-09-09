// Deliberately narrow, the same way the CRM's config is.
//
// The value of a lint sweep is that a finding means something real. Turning on
// eslint:recommended would bury `no-undef` under stylistic noise, and a rule
// nobody reads is worse than a rule nobody turned on.
//
// no-use-before-define is here from day one rather than after it bites. It has
// caught two real crashes in the CRM: a component reading state 84 lines before
// its own useState, and an Excel export reading a Map 393 lines before its
// const. Both were white screens; both were invisible to no-undef.
//
// THE KNOWN-SAFE LIST IS DATA, not a comment. In the CRM it was four names in a
// comment while ten findings were reported, and six unfamiliar names every run
// made a seventh invisible — that seventh was a real crash. Empty here because
// there are no findings yet, and a name only joins it after somebody has
// checked WHERE the declaration is:
//
//   SAFE  — declared at MODULE scope, referenced inside a function above it.
//   CRASH — the use and the declaration in the SAME function body. Move the
//           declaration. Do not add it here.
export const KNOWN_SAFE_USE_BEFORE_DEFINE = [];

import globals from "globals";

export default [
  { ignores: ["dist/**", "node_modules/**"] },
  {
    files: ["src/**/*.{js,jsx}", "scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      "no-undef": "error",
      "no-use-before-define": ["warn", { functions: false, classes: true, variables: true }],
    },
  },
];
