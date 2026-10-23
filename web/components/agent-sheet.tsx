"use client";

import type { Message, ToolMessage } from "@ag-ui/client";
import { CopilotKitProvider, useAgent, useConfigureSuggestions, useCopilotKit, useRenderToolCall, useSuggestions } from "@copilotkit/react-core/v2";
import { ArrowUp, History, SquarePen, Trash2, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { AGENT_SEND, ToolRenderers } from "@/components/agent-blocks";
import { forgetSession, recentSessionIds, useBrief } from "@/components/brief-provider";
import { CompareTrayBar } from "@/components/compare-tray";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerClose, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { getSession, getThread, inquiriesStreamUrl, type InquiryStatus } from "@/lib/api";
import { useBackCloses } from "@/lib/use-back-closes";
import { useEventStream } from "@/lib/use-event-stream";
import { cn } from "@/lib/utils";

export { AGENT_SEND };

// a tapped chip goes to the agent as a user message whose id has this prefix; the server keeps message ids,
// so the thread read back after a reload still draws it as a chip pill
const CHIP = "chip-";

const TIMES = "pasazhgard.messageTimes";
const TIMES_MAX = 500;
const clock = new Intl.DateTimeFormat("fa-IR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Tehran" });

// AG-UI messages carry no time, so this device records when it first showed each one. 0 marks a message first seen
// in a thread read back from the server, whose time this device does not know.
function readTimes(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(TIMES) ?? "{}");
  } catch {
    return {};
  }
}

function writeTimes(times: Record<string, number>) {
  try {
    localStorage.setItem(TIMES, JSON.stringify(Object.fromEntries(Object.entries(times).slice(-TIMES_MAX))));
  } catch {}
}

// suggestion chips keyed by the kind of the thread's last block
const SUGGESTIONS: Record<string, { title: string; message: string }[]> = {
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

// a suggestion sends its message but shows its title; a chip-block option sends its own text
const TITLES: Record<string, string> = Object.fromEntries(Object.values(SUGGESTIONS).flat().map((s) => [s.message, s.title]));
const chipText = (content: unknown) => TITLES[String(content)] ?? String(content);
const userText = (m: Message) => (m.id.startsWith(CHIP) ? chipText(m.content) : String(m.content));

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
        return session && first ? { id, title: userText(first) } : null;
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
  const showHistory = useBackCloses("chatHistory", setHistoryOpen);
  const pathname = usePathname();
  // on other routes the thread is a drawer, which browser back closes; home shows it inline
  const drawer = useBackCloses("agentDrawer", setOpen);
  const show = pathname === "/" ? setOpen : drawer;
  const router = useRouter();
  const [shownPath, setShownPath] = useState(pathname);
  const [times, setTimes] = useState<Record<string, number> | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  // the log follows new content while the user is at its bottom
  const stuck = useRef(true);
  const [unseen, setUnseen] = useState(false);

  const kind = agent.messages.length ? lastBlock(agent.messages) : "";
  useConfigureSuggestions({ suggestions: SUGGESTIONS[kind] ?? [], available: "always", consumerAgentId: "sheet" }, [kind]);
  const { suggestions } = useSuggestions({ agentId: "sheet" });

  // a link in the thread opens its page in front of the drawer
  if (pathname !== shownPath) {
    setShownPath(pathname);
    setOpen(false);
  }

  // the agent posts alternatives by itself when an inquiry falls through, so every inquiry change reads the thread again
  const inquiries = useEventStream<InquiryStatus>(inquiriesStreamUrl(threadId));
  // the thread is checkpointed on the server; a reload or another route reads it back (the drawer waits for a tap)
  useEffect(() => {
    getThread(threadId).then(setThread, () => {});
  }, [threadId, inquiries]);
  // the first read-back is the thread from before this page: its messages this device never timed stay untimed
  useEffect(() => {
    let live = true;
    const known = readTimes();
    getThread(threadId).then(
      (t) => live && setTimes({ ...Object.fromEntries(t.map((m) => [m.id, 0])), ...known }),
      () => live && setTimes(known),
    );
    return () => {
      live = false;
    };
  }, [threadId]);
  useEffect(() => {
    if (!times) return;
    const fresh = agent.messages.filter((m) => !(m.id in times));
    if (!fresh.length) return;
    const now = Date.now();
    const next = { ...times, ...Object.fromEntries(fresh.map((m) => [m.id, now])) };
    setTimes(next);
    writeTimes(next);
  }, [agent.messages, times]);
  // the agent instance is swapped once the runtime registers it, so restore onto whichever is current; a message the
  // server has and the sheet lacks is one the agent posted between turns
  useEffect(() => {
    const shown = new Set(agent.messages.map((m) => m.id));
    if (agent.isRunning || !thread.some((m) => !shown.has(m.id))) return;
    agent.setMessages(thread);
  }, [agent, agent.isRunning, thread]);

  // `chip`: a tapped suggestion or chip-block option, drawn as a muted pill instead of a user bubble
  async function send(content: string, chip = false) {
    if (!content.trim() || agent.isRunning) return;
    if (!chip) setText("");
    show(true);
    stuck.current = true;
    agent.addMessage({ id: `${chip ? CHIP : ""}${crypto.randomUUID()}`, role: "user", content });
    try {
      await copilotkit.runAgent({ agent });
    } finally {
      // the turn patched the brief on the server; the brief bar shows it now
      refresh();
      // the server's thread now has this turn, so a stale read-back cannot stand in for it
      getThread(threadId).then(setThread, () => {});
    }
  }

  useEffect(() => {
    const onSend = (e: Event) => send((e as CustomEvent<string>).detail, true);
    window.addEventListener(AGENT_SEND, onSend);
    return () => window.removeEventListener(AGENT_SEND, onSend);
  });

  // opening the drawer starts at the latest turn
  useLayoutEffect(() => {
    if (!open) return;
    stuck.current = true;
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [open]);
  // messages, blocks filling in and suggestions all grow the log's content, so its size drives the follow
  const follow = useCallback((content: HTMLDivElement | null) => {
    if (!content) return;
    let height = 0;
    const observer = new ResizeObserver(() => {
      const grew = content.offsetHeight > height;
      height = content.offsetHeight;
      if (stuck.current) logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
      else if (grew) setUnseen(true);
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
  const toBottom = () => {
    stuck.current = true;
    setUnseen(false);
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  };

  // a new chat is a new session, which also starts the brief over
  const actions = (
    <div className="flex items-center">
      <Button
        variant="ghost"
        size="sm"
        className="h-11"
        disabled={agent.isRunning || !agent.messages.some((m) => m.role === "user")}
        onClick={() => resume(null)}
      >
        <SquarePen aria-hidden />
        گفتگوی جدید
      </Button>
      <Button variant="ghost" size="sm" className="h-11" onClick={() => showHistory(true)}>
        <History aria-hidden />
        تاریخچه
      </Button>
      <ChatHistory open={historyOpen} onOpenChange={showHistory} current={threadId} />
    </div>
  );

  const results = new Map(agent.messages.filter((m): m is ToolMessage => m.role === "tool").map((m) => [m.toolCallId, m]));
  const shown = agent.messages.filter((m) => m.role === "user" || m.role === "assistant");
  // one agent run draws as one group: its texts first, then its blocks
  const runs: Message[][] = [];
  for (const m of shown) {
    const last = runs.at(-1);
    if (m.role === "assistant" && last?.[0].role === "assistant") last.push(m);
    else runs.push([m]);
  }
  const sender = (i: number) => (runs[i] ? (runs[i][0].role === "user" ? "user" : "agent") : null);
  // tighter within a run of one sender, wider between runs
  const gap = (i: number) => (i === 0 ? "" : sender(i - 1) === sender(i) ? "mt-1" : "mt-4");
  const time = (id: string) =>
    times?.[id] ? <time className="self-end text-xs leading-none opacity-70">{clock.format(times[id])}</time> : null;
  const body = (
    <>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={logRef}
          role="log"
          aria-label="گفتگو"
          className="flex min-h-0 flex-1 flex-col overflow-y-auto py-2"
          onScroll={(e) => {
            const log = e.currentTarget;
            stuck.current = log.scrollHeight - log.scrollTop - log.clientHeight < 8;
            if (stuck.current) setUnseen(false);
          }}
        >
          <div ref={follow} className="flex shrink-0 flex-col">
            {runs.map((run, i) => {
              const [m] = run;
              if (m.role === "user" && m.id.startsWith(CHIP))
                return (
                  <p
                    key={m.id}
                    data-sender="chip"
                    className={cn("max-w-[85%] self-start rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground", gap(i))}
                  >
                    {chipText(m.content)}
                  </p>
                );
              if (m.role === "user")
                return (
                  <div
                    key={m.id}
                    data-sender="user"
                    className={cn(
                      "flex max-w-[85%] flex-col gap-1 self-start rounded-2xl bg-primary px-3 py-1.5 text-sm text-primary-foreground",
                      gap(i),
                      // the last bubble of a run gets the tail on its outer bottom corner
                      sender(i + 1) !== "user" && "bubble-tail bubble-user rounded-es-none",
                    )}
                  >
                    <p className="leading-6 whitespace-pre-wrap">{String(m.content)}</p>
                    {time(m.id)}
                  </div>
                );
              const texts = run.filter((x) => x.content);
              const calls = run.flatMap((x) => (x.role === "assistant" ? (x.toolCalls ?? []) : []));
              // blocks keep to the agent's column: its side and its width limit
              return (
                <div key={m.id} className={cn("flex w-[88%] flex-col items-end gap-2 self-end", gap(i))}>
                  {texts.map((x, j) => (
                    <div
                      key={x.id}
                      data-sender="agent"
                      className={cn(
                        "flex max-w-full flex-col gap-1 rounded-2xl bg-card px-3 py-1.5 text-sm text-card-foreground",
                        j === texts.length - 1 && !calls.length && "bubble-tail bubble-agent rounded-ee-none",
                      )}
                    >
                      <p className="leading-6 whitespace-pre-wrap">{String(x.content)}</p>
                      {time(x.id)}
                    </div>
                  ))}
                  {calls.map((toolCall) => (
                    <div key={toolCall.id} className="w-full min-w-0">
                      {renderToolCall({ toolCall, toolMessage: results.get(toolCall.id) })}
                    </div>
                  ))}
                </div>
              );
            })}
            {agent.isRunning ? (
              <p
                data-sender="agent"
                className={cn(
                  "bubble-tail bubble-agent self-end rounded-2xl rounded-ee-none bg-card px-3 py-2 text-xs text-muted-foreground",
                  runs.length > 0 && (sender(runs.length - 1) === "agent" ? "mt-1" : "mt-4"),
                )}
              >
                در حال فکر کردن...
              </p>
            ) : (
              suggestions.length > 0 && (
                <div role="group" aria-label="پیشنهادها" className="mt-3 flex flex-wrap gap-1.5">
                  {suggestions.map((s) => (
                    <Button key={s.title} variant="outline" size="sm" className="h-9 bg-card px-3" onClick={() => send(s.message, true)}>
                      {s.title}
                    </Button>
                  ))}
                </div>
              )
            )}
          </div>
        </div>
        {unseen && (
          <Button
            variant="outline"
            size="sm"
            className="absolute bottom-2 left-1/2 h-9 -translate-x-1/2 rounded-full bg-card px-3 shadow-sm"
            onClick={toBottom}
          >
            پیام جدید
          </Button>
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
          placeholder={shown.length ? "بپرسید یا شرط اضافه کنید" : "چه چیزی لازم دارید؟"}
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
      // fills the screen under home's 56 px app bar: the thread with the input at the bottom
      <div className="fixed inset-x-0 top-14 bottom-0 flex flex-col">
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
            <Button variant="outline" className="h-10 justify-start text-muted-foreground" onClick={() => show(true)}>
              دستیار خرید
            </Button>
          </div>
        </div>
      )}
      {/* not modal: the app bar and brief bar above the drawer stay usable */}
      <Drawer open={open} onOpenChange={show} modal={false} showSwipeHandle>
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
