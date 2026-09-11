import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  // Keep the starter on the flat config export that actually runs under the pinned ESLint/Next toolchain.
  ...nextCoreWebVitals,
  // .claude/** holds scratch git worktrees, which are full copies of the repo at
  // whatever commit they were cut from. Without this, lint reports every issue
  // twice — once from src/, once from a stale copy — and fails on bugs that were
  // already fixed on main.
  globalIgnores([".next/**", "out/**", "build/**", ".claude/**", "next-env.d.ts"]),
]);
