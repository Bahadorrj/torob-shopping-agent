"use client";

import type { Message } from "@ag-ui/client";
import { CopilotKitProvider, useAgent, useCopilotKit } from "@copilotkit/react-core/v2";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { Block } from "@/components/agent-blocks";
import { useBrief } from "@/components/brief-provider";
import { CompareTrayBar } from "@/components/compare-tray";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getThread } from "@/lib/api";

export const HELP_CHOOSE = "کمکم کن انتخاب کنم";
// the home screen's input and guided discovery entry post their text to the sheet through this window event
export const AGENT_SEND = "agent-send";

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
  const { refresh } = useBrief();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [thread, setThread] = useState<Message[]>([]);
  const pathname = usePathname();
  const [shownPath, setShownPath] = useState(pathname);

  // a link in the thread opens its page in front of the sheet
  if (pathname !== shownPath) {
    setShownPath(pathname);
    setOpen(false);
  }

  // the thread is checkpointed on the server; a reload or another route reads it back
  useEffect(() => {
    getThread(threadId).then(
      (t) => {
        setThread(t);
        if (t.length > 0) setOpen(true);
      },
      () => {},
    );
  }, [threadId]);
  // the agent instance is swapped once the runtime registers it, so restore onto whichever is current
  useEffect(() => {
    if (thread.length === 0 || agent.messages.length > 0) return;
    agent.setMessages(thread);
  }, [agent, thread]);

  async function send(content: string) {
    if (!content.trim() || agent.isRunning) return;
    setText("");
    setOpen(true);
    agent.addMessage({ id: crypto.randomUUID(), role: "user", content });
    try {
      await copilotkit.runAgent({ agent });
    } finally {
      // the turn patched the brief on the server; the brief bar shows it now
      refresh();
    }
  }

  useEffect(() => {
    const onSend = (e: Event) => send((e as CustomEvent<string>).detail);
    window.addEventListener(AGENT_SEND, onSend);
    return () => window.removeEventListener(AGENT_SEND, onSend);
  });

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
        <CompareTrayBar />
        {agent.messages.length === 0 && (
          <Button variant="outline" size="sm" className="self-start" onClick={() => send(HELP_CHOOSE)}>
            {HELP_CHOOSE}
          </Button>
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
