import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

// Flat config for the marketing site. Mirrors apps/desktop's setup and reuses
// the monorepo's hoisted ESLint tooling, so no web-specific deps are needed.
// Replaces the deprecated `next lint`, which prompted interactively (and failed
// in CI / non-interactive shells) because no ESLint config was present.
export default [
  { ignores: [".next", ".turbo", "next-env.d.ts"] },
  // Node config files (next.config.mjs, postcss.config.js, …)
  {
    files: ["*.{js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-console": "off",
    },
  },
  // TypeScript / React (App Router)
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        ecmaFeatures: { jsx: true },
        sourceType: "module",
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // tsc (`npm run typecheck`) owns these for TS sources.
      "no-undef": "off",
      "no-unused-vars": "off",
      "no-console": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
];
