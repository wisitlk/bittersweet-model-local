import { defineConfig } from "vitest/config";

export default defineConfig({
  // wrangler loads content/*.md, *.txt and web/*.html as text modules; do the same in tests so src/index.ts can be imported.
  plugins: [
    {
      name: "text-modules",
      enforce: "pre",
      transform(code, id) {
        if (/\.(md|txt|html)$/.test(id)) return { code: `export default ${JSON.stringify(code)};`, map: null };
        return null;
      },
    },
  ],
  test: { include: ["test/**/*.test.ts"] },
});
