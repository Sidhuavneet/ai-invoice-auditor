export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export type InvoiceSummary = {
  file: string;
  invoice_no: string;
  invoice_date: string;
  vendor: string;
  currency: string;
  total: string | number;
  recommendation: string;
  status: string;
};

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return res.json();
}

export type StatsResponse = {
  kpis: {
    total_invoices: number;
    pending: number;
    approved: number;
    rejected: number;
    manual_review: number;
    auto_approval_rate: number;
    avg_translation_confidence: number;
    total_line_items: number;
    spend_by_currency: Record<string, number>;
  };
  status_distribution: { status: string; count: number }[];
  top_vendors: { vendor: string; spend: number; count: number; currency: string }[];
  spend_timeline: { date: string; amount: number }[];
  discrepancy_reasons: { reason: string; count: number }[];
  anomalies: { file: string; vendor: string; amount: number; reason: string; median?: number }[];
};

export async function getStats(): Promise<StatsResponse> {
  const res = await fetch(`${API_URL}/stats`, { cache: "no-store" });
  return handle(res);
}

export async function listInvoices(): Promise<InvoiceSummary[]> {
  const res = await fetch(`${API_URL}/invoices`, { cache: "no-store" });
  return handle(res);
}

export async function getInvoice(name: string): Promise<any> {
  const res = await fetch(`${API_URL}/invoices/${encodeURIComponent(name)}`, {
    cache: "no-store",
  });
  return handle(res);
}

export async function processInbox(): Promise<{
  processed: number;
  errors: string[];
  indexed?: number;
  truncated?: boolean;
  max_iters?: number;
}> {
  const res = await fetch(`${API_URL}/process`, { method: "POST" });
  return handle(res);
}

export type PipelineEvent =
  | { type: "file_start"; file: string }
  | { type: "node"; file: string; node: string; label: string; status: "running" | "done" }
  | { type: "paused"; file: string }
  | { type: "file_done"; file: string; status: string; error?: string }
  | {
      type: "summary";
      processed: number;
      errors: string[];
      indexed?: number;
      truncated?: boolean;
    }
  | { type: "done" }
  | { type: "error"; message: string };

/** Stream-process the inbox. Emits per-node + per-file events so the UI can
 * render a live agent pipeline. Returns a final summary on resolve. */
export async function processInboxStream(
  onEvent: (e: PipelineEvent) => void,
  signal?: AbortSignal,
): Promise<{
  processed: number;
  errors: string[];
  indexed?: number;
  truncated?: boolean;
}> {
  const res = await fetch(`${API_URL}/process/stream`, {
    method: "POST",
    signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Stream failed: ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let summary = { processed: 0, errors: [] as string[] };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const evt of events) {
      let event = "message";
      let data = "";
      for (const line of evt.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!event) continue;
      try {
        const parsed = data ? JSON.parse(data) : {};
        if (event === "summary") summary = { ...summary, ...parsed };
        onEvent({ type: event as any, ...parsed });
      } catch {
        /* ignore malformed event */
      }
    }
  }
  return summary;
}

export function invoiceFileUrl(name: string): string {
  return `${API_URL}/invoices/${encodeURIComponent(name)}/file`;
}

export async function submitDecision(
  name: string,
  status: "accept" | "reject",
  remarks: string,
): Promise<{ ok: boolean }> {
  const res = await fetch(
    `${API_URL}/invoices/${encodeURIComponent(name)}/decision`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, remarks }),
    },
  );
  return handle(res);
}

export async function uploadInvoice(file: File): Promise<{ ok: boolean; filename: string }> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`${API_URL}/upload`, { method: "POST", body: fd });
  return handle(res);
}

export async function uploadFromUrl(url: string): Promise<{ ok: boolean; filename: string }> {
  const res = await fetch(`${API_URL}/upload-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  return handle(res);
}

export async function chat(query: string): Promise<{
  response: string;
  reviewed_response: Record<string, unknown>;
}> {
  const res = await fetch(`${API_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  return handle(res);
}

export async function chatStream(
  query: string,
  onToken: (t: string) => void,
  onDone: (reviewed: Record<string, unknown>) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_URL}/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Stream failed: ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const onAbort = () => {
    try {
      reader.cancel();
    } catch {
      /* ignore */
    }
  };
  if (signal) {
    if (signal.aborted) {
      onAbort();
      throw new DOMException("Aborted", "AbortError");
    }
    signal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const evt of events) {
        const lines = evt.split("\n");
        let event = "message";
        let data = "";
        for (const line of lines) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (!data) continue;
        try {
          const parsed = JSON.parse(data);
          if (event === "token") onToken(parsed as string);
          else if (event === "done") onDone((parsed as any).reviewed_response || {});
          else if (event === "error") throw new Error(String(parsed));
        } catch (e) {
          if (event === "error") throw e;
        }
      }
    }
  } finally {
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

