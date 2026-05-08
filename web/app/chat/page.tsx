"use client";

import { useState } from "react";
import { chat } from "@/lib/api";

type Message = {
  role: "user" | "assistant";
  content: string;
  reviewed?: Record<string, unknown>;
};

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const q = input.trim();
    if (!q || loading) return;
    setError(null);
    setInput("");
    setMessages((m) => [...m, { role: "user", content: q }]);
    setLoading(true);
    try {
      const res = await chat(q);
      setMessages((m) => [
        ...m,
        { role: "assistant", content: res.response, reviewed: res.reviewed_response },
      ]);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">QA Chatbot</h1>
        <p className="text-sm text-zinc-600">
          Ask questions about processed invoices. Powered by RAG over the FAISS index.
        </p>
      </div>

      <div className="min-h-[400px] space-y-3 rounded-lg border border-zinc-200 bg-white p-4">
        {messages.length === 0 && (
          <p className="text-sm text-zinc-500">No messages yet.</p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`rounded-md px-3 py-2 text-sm ${
              m.role === "user"
                ? "ml-auto max-w-[80%] bg-blue-600 text-white"
                : "max-w-[80%] bg-zinc-100 text-zinc-900"
            }`}
          >
            <div className="whitespace-pre-wrap">{m.content}</div>
            {m.reviewed && Object.keys(m.reviewed).length > 0 && (
              <details className="mt-2 text-xs opacity-80">
                <summary className="cursor-pointer">Answer relevancy</summary>
                <pre className="mt-1 whitespace-pre-wrap">
                  {JSON.stringify(m.reviewed, null, 2)}
                </pre>
              </details>
            )}
          </div>
        ))}
        {loading && <p className="text-sm text-zinc-500">Thinking…</p>}
      </div>

      {error && (
        <pre className="whitespace-pre-wrap rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
          {error}
        </pre>
      )}

      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
          placeholder="Type your question…"
          className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm"
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
        >
          Send
        </button>
      </div>
    </div>
  );
}
