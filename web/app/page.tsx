"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  InvoiceSummary,
  listInvoices,
  processInbox,
  statusColor,
  uploadInvoice,
} from "@/lib/api";

export default function DashboardPage() {
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    try {
      setError(null);
      const data = await listInvoices();
      setInvoices(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function onProcess() {
    setProcessing(true);
    setMessage(null);
    setError(null);
    try {
      const res = await processInbox();
      setMessage(
        res.processed
          ? `Processed ${res.processed} invoice(s).`
          : "No new invoices in inbox.",
      );
      if (res.errors?.length) setError(res.errors.join("\n"));
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setProcessing(false);
    }
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await uploadInvoice(file);
      setMessage(`Uploaded ${file.name} to inbox.`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Invoice Reports</h1>
          <p className="text-sm text-zinc-600">
            Upload invoices, run the multi-agent pipeline, and review results.
          </p>
        </div>
        <div className="flex gap-2">
          <label className="cursor-pointer rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium hover:bg-zinc-50">
            {uploading ? "Uploading…" : "Upload Invoice"}
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx,.png,.jpg,.jpeg"
              className="hidden"
              onChange={onUpload}
            />
          </label>
          <button
            onClick={onProcess}
            disabled={processing}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {processing ? "Processing…" : "Process New Invoices"}
          </button>
        </div>
      </div>

      {message && (
        <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          {message}
        </div>
      )}
      {error && (
        <pre className="whitespace-pre-wrap rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
          {error}
        </pre>
      )}

      {loading ? (
        <p className="text-zinc-500">Loading…</p>
      ) : invoices.length === 0 ? (
        <p className="text-zinc-500">No invoices processed yet.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {invoices.map((inv) => (
            <li key={inv.file}>
              <Link
                href={`/invoices/${encodeURIComponent(inv.file)}`}
                className={`block rounded-lg border p-4 transition hover:shadow ${statusColor(inv)}`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{inv.file}</span>
                  <span className="text-xs uppercase tracking-wide opacity-75">
                    {inv.status || inv.recommendation || "—"}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                  <span><span className="opacity-60">Invoice:</span> {inv.invoice_no || "—"}</span>
                  <span><span className="opacity-60">Vendor:</span> {inv.vendor || "—"}</span>
                  <span><span className="opacity-60">Date:</span> {inv.invoice_date || "—"}</span>
                  <span><span className="opacity-60">Total:</span> {inv.currency} {inv.total ?? "—"}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
