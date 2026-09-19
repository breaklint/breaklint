import js from "@eslint/js";
import tseslint from "typescript-eslint";
export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "**/dist-bundle/**", ".release/**"] },
  js.configs.recommended,
  {
    files: ["**/*.ts"],
    extends: [...tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true },
      ],
    },
  },
  {
    files: ["**/*.{mjs,js}"],
    languageOptions: {
      globals: Object.fromEntries(
        [
          "console",
          "process",
          "Buffer",
          "Response",
          "structuredClone",
          "TextEncoder",
          "URL",
          "fetch",
          "setTimeout",
          "AbortController",
        ].map((k) => [k, "readonly"]),
      ),
    },
  },
  {
    files: ["packages/public-protocol/test/*.ts"],
    rules: { "@typescript-eslint/no-unused-vars": "off" },
  },
);
