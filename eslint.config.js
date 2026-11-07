import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules", ".wrangler", "apps_script"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // The Mac mini gate runs in Node, not in the Worker.
    files: ["mac-mini/**/*.mjs"],
    languageOptions: {
      globals: { URL: "readonly", Buffer: "readonly", process: "readonly", console: "readonly" },
    },
  },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
);
