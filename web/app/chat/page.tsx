"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { chatStream } from "@/lib/api";
import { Icon, Spinner, Toast } from "@/lib/ui";

type Message = {
  role: "user" | "assistant";
  content: string;
  reviewed?: Record<string, unknown>;
};

const SUGGESTIONS = [
  "List all invoices with their vendor, total, and status as a table",
  "What is the total amount of invoice RE-2025-004?",
  "Which invoices were flagged for manual review and why?",
  "Show line items for HafenLogistik GmbH",
];

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  // Cancel any in-flight SSE stream when the user navigates away from /chat,
  // otherwise the connection lingers and the next stream gets mixed output.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  async function send(q?: string) {
    const text = (q ?? input).trim();
    if (!text || loading) return;
    setError(null);
    setInput("");
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
      { role: "assistant", content: "" },
    ]);
    setLoading(true);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await chatStream(
        contextualised,
        (token) => {
          setMessages((m) => {
            const copy = m.slice();
            const last = copy[copy.length - 1];
            if (last && last.role === "assistant") {
              copy[copy.length - 1] = { ...last, content: last.content + token };
            }
            return copy;
          });
        },
        (reviewed) => {
          setMessages((m) => {
            const copy = m.slice();
            const last = copy[copy.length - 1];
            if (last && last.role === "assistant") {
              copy[copy.length - 1] = { ...last, reviewed };
            }
            return copy;
          });
        },
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
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-indigo-600">
          <Icon name="sparkles" className="h-3.5 w-3.5" /> RAG Chatbot
        </div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">QA Chat</h1>
        <p className="mt-1 text-sm text-stone-600">
          Ask questions about processed invoices. Powered by FAISS + Llama 3.3 over your vector index.
        </p>
      </header>

      <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
        <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm">
                <Icon name="sparkles" className="h-7 w-7" />
              </span>
              <div>
                <h3 className="text-base font-semibold">Ask anything about your invoices</h3>
                <p className="mt-1 text-sm text-stone-500">
                  Responses are grounded in the FAISS index of processed reports.
                </p>
              </div>
              <div className="mt-2 grid w-full max-w-2xl grid-cols-1 gap-2 md:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="card card-hover flex items-center gap-2 p-3 text-left text-sm text-stone-700"
                  >
                    <Icon name="search" className="h-4 w-4 shrink-0 text-indigo-500" />
                    <span>{s}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => <MessageBubble key={i} message={m} />)
          )}
          {loading && (
            <div className="animate-in flex items-center gap-2 text-sm text-stone-500">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white">
                <Icon name="sparkles" className="h-3.5 w-3.5" />
              </span>
              <Dots />
            </div>
          )}
        </div>

        {error && (
          <div className="border-t border-stone-200 p-3">
            <Toast kind="error" onClose={() => setError(null)}>{error}</Toast>
          </div>
        )}

        <div className="border-t border-stone-200 bg-stone-50/50 p-3">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Ask about an invoice, vendor, discrepancy…"
              rows={1}
              className="input min-h-[42px] resize-none"
            />
            <button
              onClick={() => send()}
              disabled={loading || !input.trim()}
              className="btn-primary"
            >
              {loading ? <Spinner /> : <Icon name="send" />}
              <span className="hidden sm:inline">Send</span>
            </button>
          </div>
          <p className="mt-1.5 px-1 text-[11px] text-stone-400">
            Press Enter to send · Shift+Enter for newline
          </p>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div className={`animate-in flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white shadow-sm ${
          isUser
            ? "bg-stone-900"
            : "bg-gradient-to-br from-indigo-500 to-violet-600"
        }`}
      >
        <Icon name={isUser ? "home" : "sparkles"} className="h-3.5 w-3.5" />
      </span>
      <div className={`max-w-[80%] ${isUser ? "items-end" : "items-start"} flex flex-col gap-1`}>
        <div
          className={`rounded-2xl px-4 py-2.5 text-sm ${
            isUser
              ? "rounded-tr-sm bg-stone-900 text-white"
              : "rounded-tl-sm border border-stone-200 bg-white text-stone-900"
          }`}
        >
          {isUser ? (
            <div className="whitespace-pre-wrap leading-relaxed">{message.content}</div>
          ) : (
            <div className="markdown leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
            </div>
          )}
        </div>
        {message.reviewed && Object.keys(message.reviewed).length > 0 && (
          <details className="ml-1 text-xs text-stone-500">
            <summary className="cursor-pointer hover:text-stone-700">
              <Icon name="info" className="mr-1 inline h-3 w-3" /> Answer relevancy
            </summary>
            <pre className="mt-1.5 max-w-md overflow-x-auto rounded-md border border-stone-200 bg-stone-50 p-2 text-[11px]">
              {JSON.stringify(message.reviewed, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}

function Dots() {
  return (
    <span className="inline-flex gap-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-stone-400"
          style={{ animationDelay: `${i * 120}ms` }}
        />
      ))}
    </span>
  );
}
