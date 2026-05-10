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
}> {
  const res = await fetch(`${API_URL}/process`, { method: "POST" });
  return handle(res);
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

