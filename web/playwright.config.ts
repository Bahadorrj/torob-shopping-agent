import { defineConfig } from "@playwright/test";

// SMOKE_PORT lets parallel worktrees run smoke without a port clash
const port = process.env.SMOKE_PORT ?? "3100";

export default defineConfig({
  testDir: "e2e",
  webServer: { command: `pnpm start --port ${port}`, url: `http://localhost:${port}` },
  // installed Chrome: the Playwright browser CDN is not reachable from Iran
  use: { baseURL: `http://localhost:${port}`, channel: "chrome", viewport: { width: 360, height: 740 } },
});
