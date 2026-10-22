"use client";

import { CopilotKitProvider, useAgent, useCopilotKit } from "@copilotkit/react-core/v2";
import { useState } from "react";

import { Block } from "@/components/agent-blocks";
import { useBrief } from "@/components/brief-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// The agent bottom sheet (PRD 9): one sentence in, blocks out. The agent's thread is the brief's session.
export function AgentSheet() {
  const { session } = useBrief();
  // the session only exists in the browser, which also keeps the provider (it reads the clock) out of prerender
  if (!session) return null;
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" useSingleEndpoint>
      <Sheet key={session.session_id} threadId={session.session_id} />
    </CopilotKitProvider>
  );
}

function Sheet({ threadId }: { threadId: string }) {
  const { agent } = useAgent({ agentId: "sheet", runtimeAgentId: "pasazhgard", threadId });
  const { copilotkit } = useCopilotKit();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

  async function send(content: string) {
    if (!content.trim() || agent.isRunning) return;
    setText("");
    setOpen(true);
    agent.addMessage({ id: crypto.randomUUID(), role: "user", content });
    await copilotkit.runAgent({ agent });
  }

  return (
    <section aria-label="دستیار" className="fixed inset-x-0 bottom-0 z-20 border-t bg-background shadow-[0_-2px_8px_rgb(0_0_0/0.08)]">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-2 px-4 py-2">
        {open && (
          <div className="flex max-h-[65dvh] flex-col gap-2 overflow-y-auto py-2">
            {agent.messages.map((m) =>
              m.role === "user" ? (
                <p key={m.id} className="self-start rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground">
                  {String(m.content)}
                </p>
              ) : m.role === "assistant" && m.content ? (
                <p key={m.id} className="text-sm leading-6">
                  {String(m.content)}
                </p>
              ) : m.role === "tool" ? (
                <Block key={m.id} content={String(m.content)} send={send} />
              ) : null,
            )}
            {agent.isRunning && <p className="text-xs text-muted-foreground">در حال فکر کردن...</p>}
          </div>
        )}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send(text);
          }}
        >
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="از دستیار بپرسید..." aria-label="پیام به دستیار" />
          <Button type="submit" size="sm" disabled={agent.isRunning}>
            بفرست
          </Button>
          {agent.messages.length > 0 && (
            <Button type="button" variant="outline" size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>
              {open ? "بستن" : "گفتگو"}
            </Button>
          )}
        </form>
      </div>
    </section>
  );
}
