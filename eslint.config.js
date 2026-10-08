import babelParser from "@babel/eslint-parser";
import js from "@eslint/js";
import globals from "globals";

const typescriptLanguageOptions = {
  parser: babelParser,
  parserOptions: {
    requireConfigFile: false,
    sourceType: "module",
    babelOptions: {
      presets: ["@babel/preset-typescript"],
    },
  },
};

export default [
  {
    ignores: [
      "coverage/**",
      "dist/**",
      "node_modules/**",
      "web-ext-artifacts/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      ...typescriptLanguageOptions,
      globals: {
        ...globals.browser,
        ...globals.webextensions,
      },
    },
  },
  {
    files: ["vite.config.ts", "vitest.config.ts"],
    languageOptions: {
      ...typescriptLanguageOptions,
      globals: globals.node,
    },
  },
  {
    files: ["tests/**/*.{ts,tsx}"],
    languageOptions: {
      ...typescriptLanguageOptions,
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.webextensions,
      },
    },
  },
];
