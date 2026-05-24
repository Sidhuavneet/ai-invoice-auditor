"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AnimatePresence, motion } from "framer-motion";
import { ChatToolResult, chatStream } from "@/lib/api";
import { Icon, Spinner, Toast } from "@/lib/ui";
import { ToolCallChip, ToolResultRenderer } from "../_components/ChatTools";
import { SlashItem, SlashPalette, pendingSlashArg } from "../_components/SlashPalette";

type Message = {
  role: "user" | "assistant";
  content: string;
  reviewed?: Record<string, unknown>;
  toolCalls?: { name: string }[];     // shown as "calling X" while running
  toolResults?: ChatToolResult[];     // rendered inline as cards
  followups?: string[];                // suggested next prompts
};

const SUGGESTIONS = [
  "Show me an overview of all invoices",
  "Which invoices need manual review?",
  "Tell me about vendor HafenLogistik",
  "What discrepancies are flagged?",
];

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSlash, setShowSlash] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Open slash palette when input starts with `/`.
  useEffect(() => {
    setShowSlash(input.startsWith("/"));
  }, [input]);

  function pickSlash(item: SlashItem) {
    setInput(item.prompt);
    setShowSlash(false);
    inputRef.current?.focus();
    // If the slash prompt is "complete" (ends with punctuation), auto-send.
    // Otherwise (e.g. "/vendor " expecting a name), keep cursor in input.
    if (/[.?]$/.test(item.prompt)) {
      setTimeout(() => send(item.prompt), 50);
    }
  }

  async function send(q?: string) {
    const text = (q ?? input).trim();
    if (!text || loading) return;
    setError(null);
    setInput("");
    setShowSlash(false);
    const history = messages.slice(-4);
    const contextualised =
      history.length > 0
        ? `Conversation so far:\n${history
            .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
            .join("\n")}\n\nCurrent question: ${text}`
        : text;
    setMessages((m) => [
      ...m,
      { role: "user", content: text },
      { role: "assistant", content: "", toolCalls: [], toolResults: [] },
    ]);
    setLoading(true);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const updateLast = (patch: (m: Message) => Message) => {
        setMessages((m) => {
          const copy = m.slice();
          const i = copy.length - 1;
          if (copy[i]?.role === "assistant") copy[i] = patch(copy[i]);
          return copy;
        });
      };
      await chatStream(
        contextualised,
        {
          onToken: (token) =>
            updateLast((last) => ({ ...last, content: last.content + token })),
          onToolCall: (call) =>
            updateLast((last) => ({
              ...last,
              toolCalls: [...(last.toolCalls || []), { name: call.name }],
            })),
          onToolResult: (result) =>
            updateLast((last) => ({
              ...last,
              toolResults: [...(last.toolResults || []), result],
              // Drop the matching "calling X" chip once the result is in.
              toolCalls: (last.toolCalls || []).filter((c) => c.name !== result.name),
            })),
          onFollowups: (followups) =>
            updateLast((last) => ({ ...last, followups })),
          onDone: (reviewed) =>
            updateLast((last) => ({ ...last, reviewed })),
        },
        undefined,
        controller.signal,
      );
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      setError(e.message);
      setMessages((m) => m.slice(0, -1));
    } finally {
      setLoading(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col gap-4">
      <header>
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-violet-300">
          <Icon name="sparkles" className="h-3.5 w-3.5" /> Agentic chat · Tool-calling · Streaming
        </div>
        <h1 className="mt-1 bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-3xl font-semibold tracking-tight text-transparent">
          QA Chat
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Tool-calling chat over your invoice corpus. Try{" "}
          <code className="rounded bg-white/[0.05] px-1 py-0.5 text-violet-300">/</code> for
          commands.
        </p>
      </header>

      <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
        <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {messages.length === 0 ? (
            <Welcome onPick={send} />
          ) : (
            messages.map((m, i) => (
              <MessageBubble
                key={i}
                message={m}
                onFollowup={send}
                isLast={i === messages.length - 1}
                loading={loading && i === messages.length - 1}
              />
            ))
          )}
        </div>

        {error && (
          <div className="border-t border-[color:var(--border)] p-3">
            <Toast kind="error" onClose={() => setError(null)}>
              {error}
            </Toast>
          </div>
        )}

        <div className="relative border-t border-[color:var(--border)] bg-white/[0.02] p-3">
          <AnimatePresence>
            {showSlash && (
              <SlashPalette
                query={input}
                onPick={pickSlash}
                onClose={() => setShowSlash(false)}
              />
            )}
          </AnimatePresence>
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !showSlash) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Ask about an invoice, vendor, discrepancy… or type /"
              rows={1}
              className="input min-h-[42px] resize-none"
            />
            <button
              onClick={() => send()}
              disabled={loading || !input.trim() || !!pendingSlashArg(input)}
              className="btn-primary"
            >
              {loading ? <Spinner /> : <Icon name="send" />}
              <span className="hidden sm:inline">Send</span>
            </button>
          </div>
          {pendingSlashArg(input) ? (
            <p className="mt-1.5 px-1 text-[11px] text-amber-300">
              <Icon name="alert" className="mr-1 inline h-3 w-3" />
              Finish the command — type a{" "}
              <span className="font-mono">{pendingSlashArg(input)!.argPlaceholder}</span> then hit Enter.
            </p>
          ) : (
            <p className="mt-1.5 px-1 text-[11px] text-zinc-600">
              Enter to send · Shift+Enter newline ·{" "}
              <span className="font-mono text-violet-300">/</span> for commands
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Welcome({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      <span
        className="flex h-14 w-14 items-center justify-center rounded-full text-white"
        style={{
          background: "linear-gradient(135deg, rgb(167,139,250) 0%, rgb(34,211,238) 100%)",
          boxShadow: "0 0 40px -6px rgb(167 139 250 / 0.6)",
        }}
      >
        <Icon name="sparkles" className="h-7 w-7" />
      </span>
      <div>
        <h3 className="text-base font-semibold text-zinc-100">Ask about your invoices</h3>
        <p className="mt-1 text-sm text-zinc-500">
          I can look up specific invoices, vendor stats, flagged items, and overall trends.
          Try a slash command or one of the prompts below.
        </p>
      </div>
      <div className="mt-2 grid w-full max-w-2xl grid-cols-1 gap-2 md:grid-cols-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="card card-hover flex items-center gap-2 p-3 text-left text-sm text-zinc-300"
          >
            <Icon name="search" className="h-4 w-4 shrink-0 text-violet-300" />
            <span>{s}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  onFollowup,
  isLast,
  loading,
}: {
  message: Message;
  onFollowup: (q: string) => void;
  isLast: boolean;
  loading: boolean;
}) {
  const isUser = message.role === "user";
  const hasToolResults = (message.toolResults?.length || 0) > 0;
  const hasToolCalls = (message.toolCalls?.length || 0) > 0;

  return (
    <div className={`animate-in flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white"
        style={
          isUser
            ? { background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.15)" }
            : {
                background: "linear-gradient(135deg, rgb(167,139,250) 0%, rgb(34,211,238) 100%)",
                boxShadow: "0 0 16px -4px rgb(167 139 250 / 0.6)",
              }
        }
      >
        <Icon name={isUser ? "home" : "sparkles"} className="h-3.5 w-3.5" />
      </span>
      <div className={`max-w-[85%] ${isUser ? "items-end" : "items-start"} flex min-w-0 flex-col gap-2`}>
        {/* Tool call chips (running) — only visible while tools haven't returned yet */}
        {!isUser && hasToolCalls && (
          <div className="flex flex-wrap gap-1.5">
            {message.toolCalls!.map((tc, i) => (
              <ToolCallChip key={`${tc.name}-${i}`} name={tc.name} />
            ))}
          </div>
        )}

        {/* Tool result cards (rendered inline) */}
        {!isUser && hasToolResults && (
          <div className="space-y-2">
            {message.toolResults!.map((r, i) => (
              <ToolResultRenderer key={i} kind={r.kind} payload={r.payload} />
            ))}
          </div>
        )}

        {/* Narrative bubble */}
        {(message.content || isUser) && (
          <div
            className={`rounded-2xl px-4 py-2.5 text-sm ${
              isUser
                ? "rounded-tr-sm bg-white/[0.08] text-zinc-100 ring-1 ring-inset ring-white/10"
                : "rounded-tl-sm border border-[color:var(--border)] bg-[color:var(--bg-card)]/80 text-zinc-100 backdrop-blur-md"
            }`}
          >
            {isUser ? (
              <div className="whitespace-pre-wrap leading-relaxed">{message.content}</div>
            ) : (
              <div className="markdown leading-relaxed">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                {loading && !message.content && (
                  <span className="inline-flex gap-1 align-middle">
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-violet-400"
                        style={{
                          animationDelay: `${i * 120}ms`,
                          boxShadow: "0 0 8px rgb(167 139 250 / 0.6)",
                        }}
                      />
                    ))}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Suggested follow-ups */}
        {!isUser && isLast && !loading && (message.followups?.length || 0) > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="flex flex-wrap gap-1.5"
          >
            {message.followups!.map((f, i) => (
              <button
                key={i}
                onClick={() => onFollowup(f)}
                className="inline-flex items-center gap-1 rounded-full border border-[color:var(--border)] bg-white/[0.03] px-2.5 py-1 text-xs text-zinc-300 transition-colors hover:border-violet-500/40 hover:bg-violet-500/10 hover:text-violet-200"
              >
                <Icon name="sparkles" className="h-3 w-3 text-violet-300" /> {f}
              </button>
            ))}
          </motion.div>
        )}

      </div>
    </div>
  );
}
