import { defineConfig } from "@playwright/test";

// SMOKE_PORT lets parallel worktrees run smoke without a port clash
const port = process.env.SMOKE_PORT ?? "3100";
const agentPort = String(Number(port) + 1);

export default defineConfig({
  testDir: "e2e",
  webServer: [
    { command: `node e2e/fake-agent.mjs ${agentPort}`, port: Number(agentPort) },
    {
      command: `pnpm start --port ${port}`,
      url: `http://localhost:${port}`,
      env: { AGENT_URL: `http://localhost:${agentPort}`, COPILOTKIT_TELEMETRY_DISABLED: "true" },
    },
  ],
  // installed Chrome: the Playwright browser CDN is not reachable from Iran
  use: { baseURL: `http://localhost:${port}`, channel: "chrome", viewport: { width: 360, height: 740 } },
});
