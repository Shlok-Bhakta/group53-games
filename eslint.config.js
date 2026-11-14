import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import globals from "globals";
import css from "@eslint/css";
import group53 from "./eslint/plugin.js";

const NON_PORTABLE_MATH = [
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "sinh",
  "cosh",
  "tanh",
  "asinh",
  "acosh",
  "atanh",
  "exp",
  "expm1",
  "log",
  "log1p",
  "log2",
  "log10",
  "pow",
  "hypot",
  "cbrt",
].map((property) => ({
  object: "Math",
  property,
  message: "Not bit-identical across JavaScriptCore (iPhones) and V8 (Android, the server). Use convex/golf/dmath.ts.",
}));

const NO_CLOCK = [
  {
    object: "Math",
    property: "random",
    message: "Deterministic code takes its randomness from a seed (the world's or the setting's rng).",
  },
  { object: "Date", property: "now", message: "Deterministic code takes time as ticks, never the wall clock." },
  { object: "performance", property: "now", message: "Deterministic code takes time as ticks, never the wall clock." },
];

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "convex/_generated/**",
      "convex/scrabble/words.ts",
      "convex/golf/solutions.ts",
      "stonks/**",
      "e2e/.state/**",
      "test-results/**",
      "playwright-report/**",
      ".claude/**",
      "public/**",
    ],
  },
  {
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" },
  },
  { ...js.configs.recommended, files: ["**/*.{ts,tsx,js,mjs}"] },
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: ["**/*.{ts,tsx,js,mjs}"] })),
  {
    files: ["**/*.{ts,tsx,js,mjs}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { group53 },
    rules: {
      "group53/no-comments": "error",
      "group53/no-raw-color": "error",
      "group53/package-boundaries": "error",
      "@typescript-eslint/ban-ts-comment": ["error", { "ts-expect-error": true, "ts-ignore": true, "ts-nocheck": true, "ts-check": false }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/naming-convention": [
        "error",
        { selector: "default", format: ["camelCase"], leadingUnderscore: "allow" },
        { selector: "variable", filter: { regex: "^__[A-Z_]+__$", match: true }, format: null },
        { selector: "variable", format: ["camelCase", "PascalCase", "UPPER_CASE"], leadingUnderscore: "allow" },
        { selector: "function", format: ["camelCase", "PascalCase"] },
        { selector: "parameter", format: ["camelCase", "PascalCase"], leadingUnderscore: "allow" },
        { selector: "typeLike", format: ["PascalCase"] },
        { selector: "enumMember", format: ["PascalCase"] },
        { selector: "import", format: null },
        { selector: ["objectLiteralProperty", "objectLiteralMethod", "typeProperty", "typeMethod"], format: null },
        { selector: ["classProperty", "classMethod", "accessor"], format: ["camelCase"], leadingUnderscore: "allow" },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "framer-motion", message: "Use motion/react." },
            { name: "lucide-react", message: "Use Phosphor icons (@phosphor-icons/react, *Icon exports)." },
            { name: "react-icons", message: "Use Phosphor icons (@phosphor-icons/react, *Icon exports)." },
            { name: "vaul", message: "Use Sheet from @/components/ui/sheet." },
          ],
          patterns: [{ group: ["@radix-ui/*"], message: "Import Radix from the single `radix-ui` package." }],
        },
      ],
    },
  },
  {
    files: ["src/**/*.tsx", "prototypes/**/*.tsx"],
    plugins: { "react-hooks": reactHooks, "jsx-a11y": jsxA11y },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-hooks/refs": "off",
      "react-hooks/preserve-manual-memoization": "off",
      ...jsxA11y.flatConfigs.recommended.rules,
      "group53/no-raw-button": "error",
      "group53/no-raw-avatar": "error",
      "group53/design-tokens": "error",
      "group53/no-async-onclick": "error",
    },
  },
  {
    files: ["src/**/*.ts"],
    plugins: { "react-hooks": reactHooks },
    rules: { ...reactHooks.configs.recommended.rules, "react-hooks/refs": "off", "react-hooks/preserve-manual-memoization": "off" },
  },
  {
    files: ["src/components/ui/drawer.tsx"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    files: ["convex/*/**/*.ts"],
    ignores: ["convex/lib/**", "**/*.test.ts"],
    languageOptions: { globals: { ...globals.es2024 } },
    rules: {
      "no-restricted-globals": [
        "error",
        "window",
        "document",
        "localStorage",
        "sessionStorage",
        "navigator",
        "location",
        "requestAnimationFrame",
      ],
    },
  },
  {
    files: ["convex/golf/**/*.ts", "convex/chess/realtime.ts", "convex/chess/four/**/*.ts"],
    ignores: ["**/*.test.ts", "convex/golf/dmath.ts"],
    rules: {
      "no-restricted-properties": ["error", ...NON_PORTABLE_MATH, ...NO_CLOCK],
      "no-restricted-syntax": [
        "error",
        {
          selector: "BinaryExpression[operator='**']",
          message: "`**` isn't bit-identical across engines. Multiply, or use convex/golf/dmath.ts.",
        },
      ],
    },
  },
  {
    files: ["**/*.css"],
    language: "css/css",
    languageOptions: { tolerant: true },
    plugins: { css, group53 },
    rules: { "group53/tailwind-css": "error" },
  },
  {
    files: ["e2e/**/*.ts"],
    rules: { "group53/e2e-waits": "error" },
  },
);
