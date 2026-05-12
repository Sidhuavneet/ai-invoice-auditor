"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  InvoiceSummary,
  listInvoices,
  processInbox,
  rebuildIndex,
  uploadFromUrl,
  uploadInvoice,
} from "@/lib/api";
import {
  Icon,
  Spinner,
  StatusPill,
  Toast,
  classifyStatus,
  formatCurrency,
} from "@/lib/ui";

type Filter = "all" | "approved" | "rejected" | "review" | "pending";

export default function DashboardPage() {
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [dragOver, setDragOver] = useState(false);
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

  // Prevent the browser's default "open dropped image as new page" behaviour
  // anywhere on the document, so the dashboard's drop zone always wins.
  useEffect(() => {
    const stop = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragover", stop);
    window.addEventListener("drop", stop);
    return () => {
      window.removeEventListener("dragover", stop);
      window.removeEventListener("drop", stop);
    };
  }, []);

  async function onProcess() {
    setProcessing(true);
    setMessage(null);
    setError(null);
    try {
      const res = await processInbox();
      const base = res.processed
        ? `Processed ${res.processed} invoice${res.processed === 1 ? "" : "s"}.`
        : "No new invoices in inbox.";
      const truncMsg = res.truncated
        ? ` Stopped at ${res.max_iters ?? "the"} per-request cap — click Process again to continue.`
        : "";
      setMessage(base + truncMsg);
      if (res.errors?.length) setError(res.errors.join("\n"));
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setProcessing(false);
    }
  }

  async function onRebuild() {
    setRebuilding(true);
    setMessage(null);
    setError(null);
    try {
      const res = await rebuildIndex();
      setMessage(`Rebuilt index from ${res.indexed} report${res.indexed === 1 ? "" : "s"}. Chat is ready.`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRebuilding(false);
    }
  }

  async function handleUrl(url: string) {
    setUploading(true);
    setError(null);
    try {
      const up = await uploadFromUrl(url);
      setMessage(`Fetched ${up.filename} from URL. Running pipeline…`);
      setProcessing(true);
      const res = await processInbox();
      setMessage(
        res.processed
          ? `Processed ${res.processed} invoice${res.processed === 1 ? "" : "s"}. Chat is up to date.`
          : `Fetched ${up.filename}.`,
      );
      if (res.errors?.length) setError(res.errors.join("\n"));
      await refresh();
    } catch (err: any) {
      const detail = (err.message || "").includes("403") || (err.message || "").includes("hotlink")
        ? `${err.message}\n\nQuick fix: open ${url.length > 60 ? url.slice(0, 60) + "…" : url} in a new tab → right-click → "Save image as…" → drag the saved file onto this zone.`
        : err.message;
      setError(detail);
      throw err;
    } finally {
      setUploading(false);
      setProcessing(false);
    }
  }

  async function handleFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      await uploadInvoice(file);
      setMessage(`Uploaded ${file.name}. Running the pipeline…`);
      setProcessing(true);
      const res = await processInbox();
      setMessage(
        res.processed
          ? `Processed ${res.processed} invoice${res.processed === 1 ? "" : "s"}. Chat is up to date.`
          : `Uploaded ${file.name}. (No new files were picked up — already processed?)`,
      );
      if (res.errors?.length) setError(res.errors.join("\n"));
      await refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
      setProcessing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) await handleFile(file);
  }

  const stats = useMemo(() => {
    const counts = { total: invoices.length, approved: 0, rejected: 0, review: 0, pending: 0 };
    let totalAmount = 0;
    for (const inv of invoices) {
      const k = classifyStatus(inv);
      if (k === "approved") counts.approved++;
      else if (k === "rejected") counts.rejected++;
      else if (k === "review") counts.review++;
      else counts.pending++;
      // Strip currency symbols/thousands separators so "1,234.56" or "₹1,234" parse.
      const raw = String(inv.total ?? "").replace(/[^0-9.\-]/g, "");
      const n = parseFloat(raw);
      if (!Number.isNaN(n)) totalAmount += n;
    }
    return { ...counts, totalAmount };
  }, [invoices]);

  const filtered = useMemo(() => {
    return invoices.filter((inv) => {
      if (filter !== "all" && classifyStatus(inv) !== filter) return false;
      if (!query) return true;
      const q = query.toLowerCase();
      return (
        inv.file?.toLowerCase().includes(q) ||
        inv.invoice_no?.toLowerCase().includes(q) ||
        inv.vendor?.toLowerCase().includes(q)
      );
    });
  }, [invoices, query, filter]);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-indigo-600">
            <Icon name="sparkles" className="h-3.5 w-3.5" /> Dashboard
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Invoice Reports</h1>
          <p className="mt-1 text-sm text-stone-600">
            Drop invoices, run the multi-agent pipeline, and review extracted data.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={refresh} className="btn-ghost" title="Refresh">
            <Icon name="refresh" />
          </button>
          <button
            onClick={onRebuild}
            disabled={rebuilding}
            className="btn-ghost"
            title="Rebuild FAISS index from existing reports (fixes chat)"
          >
            {rebuilding ? <Spinner /> : <Icon name="sparkles" />}
            {rebuilding ? "Rebuilding…" : "Rebuild Chat Index"}
          </button>
          <label className="btn-ghost cursor-pointer">
            {uploading ? <Spinner /> : <Icon name="upload" />}
            {uploading ? "Uploading…" : "Upload"}
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx,.png,.jpg,.jpeg"
              className="hidden"
              onChange={onUpload}
            />
          </label>
          <button onClick={onProcess} disabled={processing} className="btn-primary">
            {processing ? <Spinner /> : <Icon name="play" />}
            {processing ? "Processing…" : "Process Inbox"}
          </button>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total Invoices" value={stats.total} icon="file" tint="indigo" />
        <StatCard label="Approved" value={stats.approved} icon="check" tint="emerald" />
        <StatCard label="Needs Review" value={stats.review} icon="alert" tint="amber" />
        <StatCard label="Rejected" value={stats.rejected} icon="x" tint="rose" />
      </section>

      {message && <Toast kind="success" onClose={() => setMessage(null)}>{message}</Toast>}
      {error && <Toast kind="error" onClose={() => setError(null)}>{error}</Toast>}

      <section
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={async (e) => {
          e.preventDefault();
          setDragOver(false);

          // 1) Direct File from OS file system (Finder / Explorer).
          const direct = e.dataTransfer.files?.[0];
          if (direct) {
            await handleFile(direct);
            return;
          }

          // 2) DataTransferItem.getAsFile — browsers often expose the cached
          //    bytes of an image dragged from a tab here, even when
          //    dataTransfer.files is empty.
          const items = Array.from(e.dataTransfer.items || []);
          for (const it of items) {
            if (it.kind === "file") {
              const f = it.getAsFile();
              if (f && f.size > 0) {
                await handleFile(f);
                return;
              }
            }
          }

          // 3) URL fallback — backend fetches it server-side.
          //    Build a list of candidate URLs and prefer ones that *look* like
          //    direct image/PDF assets. A page URL like canva.com/templates/
          //    will fail with 403/HTML and is useless to us.
          const candidates: string[] = [];
          const html = e.dataTransfer.getData("text/html");
          const htmlMatch = html.match(/<img[^>]+src=["']([^"']+)["']/i);
          if (htmlMatch && htmlMatch[1].startsWith("http")) candidates.push(htmlMatch[1]);
          e.dataTransfer
            .getData("text/uri-list")
            .split("\n")
            .filter((l) => l.startsWith("http"))
            .forEach((u) => candidates.push(u));
          const plain = e.dataTransfer.getData("text/plain");
          if (plain.startsWith("http")) candidates.push(plain);

          const isAsset = (u: string) => /\.(png|jpe?g|webp|gif|pdf)(\?|$)/i.test(u);
          const url = candidates.find(isAsset) || candidates[0];

          if (!url) {
            setError("Drop didn't contain a file or image URL. Drag from Google Images results, or right-click → 'Save image as…' and drag the saved file.");
            return;
          }
          if (!isAsset(url)) {
            setError(`That looks like a webpage URL (${new URL(url).hostname}), not an image. Open the actual image in its own tab first, or use the Upload button.`);
            return;
          }
          try {
            await handleUrl(url);
          } catch {
            /* handleUrl already set an actionable toast */
          }
        }}
        className={`card flex items-center justify-between gap-4 p-4 transition-all ${
          dragOver ? "ring-2 ring-indigo-300" : ""
        }`}
      >
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-50 to-violet-50 text-indigo-600 ring-1 ring-inset ring-indigo-100">
            <Icon name="upload" className="h-5 w-5" />
          </span>
          <div>
            <div className="text-sm font-medium">Drag & drop invoices here</div>
            <div className="text-xs text-stone-500">PDF, DOCX, PNG, JPG · or use the Upload button</div>
          </div>
        </div>
        <span className="hidden text-xs text-stone-400 md:block">
          {dragOver ? "Release to upload…" : "Files land in inbox/"}
        </span>
      </section>

      <section className="card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-stone-200 p-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Icon name="search" className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search file, invoice #, vendor…"
                className="input pl-8 md:w-72"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(["all", "approved", "review", "rejected", "pending"] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-full px-3 py-1 text-xs font-medium capitalize ring-1 ring-inset transition-colors ${
                  filter === f
                    ? "bg-stone-900 text-white ring-stone-900"
                    : "bg-white text-stone-600 ring-stone-200 hover:bg-stone-50"
                }`}
              >
                {f}
                {f !== "all" && (
                  <span className="ml-1 opacity-70">
                    {f === "approved"
                      ? stats.approved
                      : f === "review"
                        ? stats.review
                        : f === "rejected"
                          ? stats.rejected
                          : stats.pending}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-16" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            hasInvoices={invoices.length > 0}
            onUploadClick={() => fileRef.current?.click()}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 bg-stone-50/50 text-left">
                  <Th>File</Th>
                  <Th>Invoice #</Th>
                  <Th>Vendor</Th>
                  <Th>Date</Th>
                  <Th className="text-right">Total</Th>
                  <Th>Status</Th>
                  <Th className="w-8"></Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((inv, i) => (
                  <tr
                    key={inv.file}
                    className="group animate-in border-b border-stone-100 last:border-0 hover:bg-stone-50/60"
                    style={{ animationDelay: `${i * 25}ms` }}
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/invoices/${encodeURIComponent(inv.file)}`}
                        className="flex items-center gap-2 font-medium text-stone-900 hover:text-indigo-600"
                      >
                        <Icon name="file" className="h-4 w-4 text-stone-400" />
                        <span className="truncate">{inv.file}</span>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-stone-700">{inv.invoice_no || "—"}</td>
                    <td className="px-4 py-3 text-stone-700">{inv.vendor || "—"}</td>
                    <td className="px-4 py-3 text-stone-500">{inv.invoice_date || "—"}</td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums text-stone-900">
                      {formatCurrency(inv.total, inv.currency)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill kind={classifyStatus(inv)} />
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/invoices/${encodeURIComponent(inv.file)}`}
                        className="text-stone-400 transition-colors group-hover:text-indigo-600"
                        aria-label="open"
                      >
                        <Icon name="arrow-right" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={`px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-stone-500 ${className}`}>
      {children}
    </th>
  );
}

function StatCard({
  label,
  value,
  icon,
  tint,
}: {
  label: string;
  value: number | string;
  icon: any;
  tint: "indigo" | "emerald" | "amber" | "rose";
}) {
  const tints: Record<string, string> = {
    indigo: "from-indigo-50 to-indigo-100/40 text-indigo-600 ring-indigo-100",
    emerald: "from-emerald-50 to-emerald-100/40 text-emerald-600 ring-emerald-100",
    amber: "from-amber-50 to-amber-100/40 text-amber-600 ring-amber-100",
    rose: "from-rose-50 to-rose-100/40 text-rose-600 ring-rose-100",
  };
  return (
    <div className="card card-hover flex items-center gap-3 p-4">
      <div
        className={`flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br ring-1 ring-inset ${tints[tint]}`}
      >
        <Icon name={icon} className="h-5 w-5" />
      </div>
      <div>
        <div className="text-xs font-medium uppercase tracking-wider text-stone-500">{label}</div>
        <div className="mt-0.5 text-2xl font-semibold tabular-nums">{value}</div>
      </div>
    </div>
  );
}

function EmptyState({
  hasInvoices,
  onUploadClick,
}: {
  hasInvoices: boolean;
  onUploadClick: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-indigo-50 to-violet-50 text-indigo-500 ring-1 ring-inset ring-indigo-100">
        <Icon name="file" className="h-7 w-7" />
      </span>
      <h3 className="text-base font-semibold">
        {hasInvoices ? "No matches" : "No invoices yet"}
      </h3>
      <p className="max-w-sm text-sm text-stone-500">
        {hasInvoices
          ? "Try clearing filters or your search query."
          : "Upload an invoice or drop one into the inbox/, then click Process to run the multi-agent pipeline."}
      </p>
      {!hasInvoices && (
        <button onClick={onUploadClick} className="btn-primary mt-1">
          <Icon name="upload" /> Upload your first invoice
        </button>
      )}
    </div>
  );
}
