import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/out/**",
      "**/dist/**",
      "**/release/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/test-results/**",
      "**/playwright-report/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Sandboxed renderers and browser-side packages.
    files: [
      "apps/desktop/src/**/*.{ts,tsx}",
      "packages/design-system/**/*.{ts,tsx}",
      "packages/presentation-engine/**/*.ts",
    ],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["apps/desktop/src/**/*.tsx", "packages/design-system/**/*.tsx"],
    ...reactHooks.configs.flat.recommended,
  },
  {
    // Electron main/preload, tooling configs and e2e tests run in Node.
    files: [
      "apps/desktop/electron/**/*.ts",
      "apps/desktop/tests/**/*.ts",
      "packages/database/**/*.ts",
      "packages/media-processing/**/*.ts",
      "packages/import-export/**/*.ts",
      "**/*.config.{ts,mjs,cjs}",
      "**/.dependency-cruiser.cjs",
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["**/*.cjs"],
    languageOptions: { sourceType: "commonjs" },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  prettier,
);
