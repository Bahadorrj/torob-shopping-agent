import { HttpAgent } from "@ag-ui/client";
import { CopilotRuntime, createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";

// CopilotKit runtime (ADR-0001): forwards agent runs to the FastAPI AG-UI endpoint.
// A static route, so it wins over the /api/:path* rewrite to FastAPI.
const runtime = new CopilotRuntime({
  agents: { pasazhgard: new HttpAgent({ url: process.env.AGENT_URL ?? `${process.env.API_URL ?? "http://localhost:8000"}/agent` }) },
});

export const POST = createCopilotRuntimeHandler({ runtime, basePath: "/api/copilotkit", mode: "single-route" });
