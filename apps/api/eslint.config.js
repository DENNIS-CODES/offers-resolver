import js from "@eslint/js";

/**
 * Minimal ESLint config. Expand as needed.
 * Keep lint strict in core files (resolver, SQL builder, jobs).
 */
export default [
  js.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "no-unused-vars": "off"
    }
  }
];
