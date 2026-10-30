import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // All Meta traffic goes through packages/meta (CLAUDE.md).
    ignores: ["eslint.config.mjs"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/graph\\.facebook\\.com/], TemplateElement[value.raw=/graph\\.facebook\\.com/]",
          message: "Call Meta through @fahd/meta, never graph.facebook.com directly.",
        },
      ],
    },
  },
  globalIgnores([".next/**", "next-env.d.ts", "playwright-report/**", "test-results/**"]),
]);
