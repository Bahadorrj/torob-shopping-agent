"use client";

import type { Message, ToolMessage } from "@ag-ui/client";
import { CopilotKitProvider, useAgent, useConfigureSuggestions, useCopilotKit, useRenderToolCall, useSuggestions } from "@copilotkit/react-core/v2";
import { ArrowUp, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { Fragment, useEffect, useState } from "react";

import { AGENT_SEND, ToolRenderers } from "@/components/agent-blocks";
import { useBrief } from "@/components/brief-provider";
import { CompareTrayBar } from "@/components/compare-tray";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerClose, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { getThread } from "@/lib/api";

export { AGENT_SEND };
export const HELP_CHOOSE = "کمکم کن انتخاب کنم";

// suggestion chips keyed by the kind of the thread's last block; "" is before the first message
const SUGGESTIONS: Record<string, { title: string; message: string }[]> = {
  "": [{ title: HELP_CHOOSE, message: HELP_CHOOSE }],
  product_cards: [
    { title: "مقایسه این دو", message: "این دو مدل را مقایسه کن" },
    { title: "فقط فروشگاه‌های باز", message: "فقط فروشگاه‌هایی که الان باز هستند" },
    { title: "با گارانتی", message: "فقط با گارانتی" },
    { title: "ارزان‌تر", message: "گزینه‌های ارزان‌تر نشان بده" },
  ],
  seller_list: [
    { title: "استعلام از ۳ ارزان‌تر", message: "از ۳ فروشنده ارزان‌تر استعلام بگیر" },
    { title: "نزدیک‌ترین", message: "نزدیک‌ترین فروشنده کدام است؟" },
    { title: "فقط ترب‌پی", message: "فقط فروشنده‌هایی که ترب‌پی دارند" },
  ],
};

function lastBlock(messages: Message[]) {
  const tool = messages.findLast((m) => m.role === "tool");
  try {
    return tool ? String(JSON.parse(String(tool.content)).block ?? "") : "";
  } catch {
    return "";
  }
}

// The agent drawer (PRD 9): one sentence in, blocks out. The agent's thread is the brief's session.
export function AgentSheet() {
  const { session } = useBrief();
  // the session only exists in the browser, which also keeps the provider (it reads the clock) out of prerender
  if (!session) return null;
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" useSingleEndpoint>
      <ToolRenderers />
      <Sheet key={session.session_id} threadId={session.session_id} />
    </CopilotKitProvider>
  );
}

function Sheet({ threadId }: { threadId: string }) {
  const { agent } = useAgent({ agentId: "sheet", runtimeAgentId: "pasazhgard", threadId });
  const { copilotkit } = useCopilotKit();
  const renderToolCall = useRenderToolCall();
  const { refresh } = useBrief();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [thread, setThread] = useState<Message[]>([]);
  const pathname = usePathname();
  const [shownPath, setShownPath] = useState(pathname);

  const kind = agent.messages.length ? lastBlock(agent.messages) : "";
  useConfigureSuggestions({ suggestions: SUGGESTIONS[kind] ?? [], available: "always", consumerAgentId: "sheet" }, [kind]);
  const { suggestions } = useSuggestions({ agentId: "sheet" });

  // a link in the thread opens its page in front of the drawer
  if (pathname !== shownPath) {
    setShownPath(pathname);
    setOpen(false);
  }

  // the thread is checkpointed on the server; a reload or another route reads it back, and waits for a tap
  useEffect(() => {
    getThread(threadId).then(setThread, () => {});
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

  const results = new Map(agent.messages.filter((m): m is ToolMessage => m.role === "tool").map((m) => [m.toolCallId, m]));

  return (
    <>
      {!open && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-card">
          <div className="mx-auto flex w-full max-w-xl flex-col gap-2 px-4 py-2">
            <CompareTrayBar />
            <Button variant="outline" className="h-10 justify-start text-muted-foreground" onClick={() => setOpen(true)}>
              دستیار خرید
            </Button>
          </div>
        </div>
      )}
      {/* not modal: the app bar and brief bar above the drawer stay usable */}
      <Drawer open={open} onOpenChange={setOpen} modal={false} showSwipeHandle>
        <DrawerContent className="h-[90dvh] max-h-[90dvh]">
          <section aria-label="دستیار" className="mx-auto flex min-h-0 w-full max-w-xl flex-1 flex-col gap-2 px-4 pb-3">
            <div className="flex items-center justify-between">
              <DrawerTitle className="font-bold">دستیار خرید</DrawerTitle>
              <DrawerClose render={<Button variant="ghost" size="icon" aria-label="بستن" />}>
                <X />
              </DrawerClose>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto py-2">
              {agent.messages.map((m) =>
                m.role === "user" ? (
                  <p key={m.id} className="self-start rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground">
                    {String(m.content)}
                  </p>
                ) : m.role === "assistant" ? (
                  <Fragment key={m.id}>
                    {m.content && <p className="text-sm leading-6">{String(m.content)}</p>}
                    {m.toolCalls?.map((toolCall) => renderToolCall({ toolCall, toolMessage: results.get(toolCall.id) }))}
                  </Fragment>
                ) : null,
              )}
              {agent.isRunning ? (
                <p className="text-xs text-muted-foreground">در حال فکر کردن...</p>
              ) : (
                suggestions.length > 0 && (
                  <div role="group" aria-label="پیشنهادها" className="flex flex-wrap gap-1.5">
                    {suggestions.map((s) => (
                      <Button key={s.title} variant="outline" size="sm" className="h-9 bg-card px-3" onClick={() => send(s.message)}>
                        {s.title}
                      </Button>
                    ))}
                  </div>
                )
              )}
            </div>
            <CompareTrayBar />
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                send(text);
              }}
            >
              <Input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="بپرسید یا شرط اضافه کنید"
                aria-label="پیام به دستیار"
                className="h-10"
              />
              <Button type="submit" variant="buy" size="icon" className="size-10" aria-label="بفرست" disabled={agent.isRunning}>
                <ArrowUp />
              </Button>
            </form>
          </section>
        </DrawerContent>
      </Drawer>
    </>
  );
}
