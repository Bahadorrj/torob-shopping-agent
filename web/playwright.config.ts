import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  webServer: { command: "pnpm start --port 3100", url: "http://localhost:3100" },
  // installed Chrome: the Playwright browser CDN is not reachable from Iran
  use: { baseURL: "http://localhost:3100", channel: "chrome", viewport: { width: 360, height: 740 } },
});
