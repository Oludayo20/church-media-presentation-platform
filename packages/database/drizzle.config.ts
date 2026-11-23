import { defineConfig } from "drizzle-kit";

// `pnpm --filter @cmp/database db:generate` writes SQL into ./migrations and
// then embeds it into src/migrations.generated.ts so the bundled main process
// carries its migrations (docs/DOCUMENTATION.md §9.2).
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./migrations",
});
