import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.e2e.ts",
  timeout: 60_000,
  // One Electron instance at a time: the app holds a single-instance lock.
  workers: 1,
  reporter: process.env["CI"] ? [["github"], ["list"]] : "list",
});
