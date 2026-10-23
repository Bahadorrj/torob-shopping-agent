"use client";

import type { Message, ToolMessage } from "@ag-ui/client";
import { CopilotKitProvider, useAgent, useConfigureSuggestions, useCopilotKit, useRenderToolCall, useSuggestions } from "@copilotkit/react-core/v2";
import { ArrowUp, History, SquarePen, Trash2, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { Fragment, useEffect, useState } from "react";

import { AGENT_SEND, ToolRenderers } from "@/components/agent-blocks";
import { FilterChipBar } from "@/components/brief-bar";
import { forgetSession, recentSessionIds, useBrief } from "@/components/brief-provider";
import { CompareTrayBar } from "@/components/compare-tray";
import { CATEGORIES } from "@/components/home-start";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerClose, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { getSession, getThread } from "@/lib/api";

export { AGENT_SEND };
export const HELP_CHOOSE = "کمکم کن انتخاب کنم";
const GREETING = "چه چیزی می‌خواهید حضوری بخرید؟";

// suggestion chips keyed by the kind of the thread's last block; "" is before the first message
const SUGGESTIONS: Record<string, { title: string; message: string }[]> = {
  "": [HELP_CHOOSE, ...CATEGORIES].map((c) => ({ title: c, message: c })),
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

// The agent (PRD 9): one sentence in, blocks out. The agent's thread is the brief's session.
// Home shows the thread inline under its app bar; other routes keep it in a drawer behind the agent bar.
export function AgentSheet() {
  const { session } = useBrief();
  // kept above the per-chat Sheet, so switching chats leaves the drawer open
  const [open, setOpen] = useState(false);
  // the session only exists in the browser, which also keeps the provider (it reads the clock) out of prerender
  if (!session) return null;
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" useSingleEndpoint>
      <ToolRenderers />
      <Sheet key={session.session_id} threadId={session.session_id} open={open} setOpen={setOpen} />
    </CopilotKitProvider>
  );
}

type Chat = { id: string; title: string };

// this device's chats titled by their first user message; gone sessions and chats nobody wrote in are left out
async function pastChats(): Promise<Chat[]> {
  const chats = await Promise.all(
    recentSessionIds().map(async (id) => {
      try {
        const [session, thread] = await Promise.all([getSession(id), getThread(id)]);
        const first = thread.find((m) => m.role === "user");
        return session && first ? { id, title: String(first.content) } : null;
      } catch {
        return null;
      }
    }),
  );
  return chats.filter((c) => c !== null);
}

function ChatHistory({ open, onOpenChange, current }: { open: boolean; onOpenChange: (open: boolean) => void; current: string }) {
  const { resume } = useBrief();
  const [chats, setChats] = useState<Chat[] | null>(null);

  useEffect(() => {
    if (open) pastChats().then(setChats);
  }, [open]);

  return (
    <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle className="font-bold">تاریخچه</DrawerTitle>
        </DrawerHeader>
        <div className="overflow-y-auto p-4">
          {chats?.length === 0 && <p className="text-sm text-muted-foreground">هنوز گفتگویی نیست.</p>}
          <ul className="flex flex-col divide-y divide-rule">
            {chats?.map((c) => (
              <li key={c.id} className="flex items-center gap-2 py-1">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 flex-col items-start py-2 text-start"
                  onClick={() => {
                    onOpenChange(false);
                    if (c.id !== current) resume(c.id);
                  }}
                >
                  <span className="w-full truncate text-sm">{c.title}</span>
                  {c.id === current && <span className="text-xs text-muted-foreground">گفتگوی فعلی</span>}
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="حذف از تاریخچه"
                  onClick={() => {
                    forgetSession(c.id);
                    setChats(chats.filter((x) => x.id !== c.id));
                  }}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function Sheet({ threadId, open, setOpen }: { threadId: string; open: boolean; setOpen: (open: boolean) => void }) {
  const { agent } = useAgent({ agentId: "sheet", runtimeAgentId: "pasazhgard", threadId });
  const { copilotkit } = useCopilotKit();
  const renderToolCall = useRenderToolCall();
  const { refresh, resume } = useBrief();
  const [text, setText] = useState("");
  const [thread, setThread] = useState<Message[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const [shownPath, setShownPath] = useState(pathname);

  const kind = agent.messages.length ? lastBlock(agent.messages) : "";
  useConfigureSuggestions({ suggestions: SUGGESTIONS[kind] ?? [], available: "always", consumerAgentId: "sheet" }, [kind]);
  const { suggestions } = useSuggestions({ agentId: "sheet" });

  // a link in the thread opens its page in front of the drawer
  if (pathname !== shownPath) {
    setShownPath(pathname);
    setOpen(false);
  }

  // the thread is checkpointed on the server; a reload or another route reads it back (the drawer waits for a tap)
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

  // a new chat is a new session, which also starts the brief over
  const actions = (
    <div className="flex items-center">
      <Button
        variant="ghost"
        size="sm"
        disabled={agent.isRunning || !agent.messages.some((m) => m.role === "user")}
        onClick={() => resume(null)}
      >
        <SquarePen aria-hidden />
        گفتگوی جدید
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
        <History aria-hidden />
        تاریخچه
      </Button>
      <ChatHistory open={historyOpen} onOpenChange={setHistoryOpen} current={threadId} />
    </div>
  );

  const results = new Map(agent.messages.filter((m): m is ToolMessage => m.role === "tool").map((m) => [m.toolCallId, m]));
  const body = (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto py-2">
        {agent.messages.length === 0 && <p className="text-sm leading-6">{GREETING}</p>}
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
          // a one-line input drops newlines, so a pasted multi-line list goes to basket mode before it lands
          onPaste={(e) => {
            const pasted = e.clipboardData.getData("text");
            if (!pasted.trim().includes("\n")) return;
            e.preventDefault();
            router.push(`/basket?${new URLSearchParams({ text: pasted })}`);
          }}
          placeholder="بپرسید یا شرط اضافه کنید"
          aria-label="پیام به دستیار"
          className="h-10"
        />
        <Button type="submit" variant="buy" size="icon" className="size-10" aria-label="بفرست" disabled={agent.isRunning}>
          <ArrowUp />
        </Button>
      </form>
    </>
  );

  if (pathname === "/") {
    return (
      // fills the screen under home's 56 px app bar: the brief bar, then the thread with the input at the bottom
      <div className="fixed inset-x-0 top-14 bottom-0 flex flex-col">
        <FilterChipBar />
        <section aria-label="دستیار" className="mx-auto flex min-h-0 w-full max-w-xl flex-1 flex-col gap-2 px-4 pb-3">
          <div className="flex justify-end pt-2">{actions}</div>
          {body}
        </section>
      </div>
    );
  }

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
            <div className="flex items-center gap-1">
              <DrawerTitle className="flex-1 font-bold">دستیار خرید</DrawerTitle>
              {actions}
              <DrawerClose render={<Button variant="ghost" size="icon" aria-label="بستن" />}>
                <X />
              </DrawerClose>
            </div>
            {body}
          </section>
        </DrawerContent>
      </Drawer>
    </>
  );
}
