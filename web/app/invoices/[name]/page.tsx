"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getInvoice, invoiceFileUrl, submitDecision } from "@/lib/api";
import { Icon, Spinner, StatusPill, Toast, formatCurrency } from "@/lib/ui";

type LineItem = Record<string, any>;

export default function InvoiceDetailPage() {
  const params = useParams<{ name: string }>();
  const router = useRouter();
  const name = decodeURIComponent(params.name);

  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [remarks, setRemarks] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setData(await getInvoice(name));
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [name]);

  async function decide(status: "accept" | "reject") {
    setSubmitting(true);
    setError(null);
    try {
      await submitDecision(name, status, remarks);
      router.refresh();
      // Poll until the saver has flipped status away from manual_review.
      // The decision endpoint returns once the graph resumes, but the file
      // write + index refresh complete asynchronously — without polling the
      // detail page would still show "Manual Review" until a manual reload.
      const expected = status === "accept" ? "approved" : "rejected";
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const refreshed = await getInvoice(name);
        const st = String(refreshed?.status || "").toLowerCase().trim().replace(/\s+/g, "_");
        if (st === expected || st === "approved" || st === "rejected" || st === "error") {
          setData(refreshed);
          return;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      // Timed out — show whatever we have.
      setData(await getInvoice(name));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <DetailSkeleton />;
  if (error)
    return (
      <div className="space-y-4">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-stone-600 hover:text-indigo-600">
          <Icon name="arrow-left" /> Back to dashboard
        </Link>
        <Toast kind="error">{error}</Toast>
      </div>
    );
  if (!data) return <p className="text-stone-500">Not found.</p>;

  const header = data.header || {};
  const items: LineItem[] = data.line_item || [];
  const summary: string[] = data.discrepancy_report?.discrepancy_summary || [];
  const norm = (v: any) =>
    (v || "").toString().toLowerCase().trim().replace(/\s+/g, "_");
  const status = norm(data.status);
  const recommendation = norm(data.recommendation);
  const needsReview = status === "manual_review" || recommendation === "manual_review";
  const itemColumns = items.length > 0 ? Object.keys(items[0]) : [];

  const kind: any =
    status === "approved" || status === "accept" || recommendation === "approve" || recommendation === "approved"
      ? "approved"
      : status === "rejected" || status === "reject" || recommendation === "reject" || recommendation === "rejected"
        ? "rejected"
        : needsReview
          ? "review"
          : "neutral";

  const discrepancies = Array.isArray(summary) ? summary : summary ? [summary] : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-zinc-400 transition-colors hover:text-violet-300"
        >
          <Icon name="arrow-left" /> Back to dashboard
        </Link>
        <span className="text-xs text-zinc-600">Invoice report</span>
      </div>

      <header className="card overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-[color:var(--border)] p-5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <span
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-violet-300"
              style={{
                background: "linear-gradient(135deg, rgba(167,139,250,0.18) 0%, rgba(34,211,238,0.10) 100%)",
                border: "1px solid rgba(167,139,250,0.25)",
                boxShadow: "0 0 24px -6px rgb(167 139 250 / 0.4)",
              }}
            >
              <Icon name="file" className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <h1 className="break-all text-xl font-semibold tracking-tight text-zinc-100">{name}</h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <StatusPill kind={kind} />
                {data.recommendation && (
                  <span className="pill bg-white/[0.04] text-zinc-300 ring-white/10">
                    Recommended: {data.recommendation}
                  </span>
                )}
                {discrepancies.length > 0 && (
                  <span className="pill bg-amber-500/10 text-amber-200 ring-amber-500/30">
                    <Icon name="alert" className="h-3 w-3" /> {discrepancies.length} issue
                    {discrepancies.length === 1 ? "" : "s"}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wider text-zinc-500">Total</div>
            <div className="mt-0.5 bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-3xl font-semibold tabular-nums text-transparent">
              {formatCurrency(header.total_amount, header.currency)}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 p-5 md:grid-cols-3">
          <Field label="Invoice #" value={header.invoice_no} />
          <Field label="Date" value={header.invoice_date} />
          <Field label="Vendor" value={header.vendor_id} />
        </div>
      </header>

      <InvoicePreviewButton name={name} />

      {discrepancies.length > 0 && (
        <section className="card border-amber-500/30 p-5" style={{ background: "linear-gradient(135deg, rgba(251,191,36,0.06) 0%, rgba(251,191,36,0.02) 100%)" }}>
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-amber-200">
            <Icon name="alert" className="h-4 w-4" /> Discrepancies
          </h2>
          <ul className="space-y-2">
            {discrepancies.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-amber-100/90">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {discrepancies.length === 0 && (
        <section className="card flex items-center gap-2 border-emerald-500/30 p-4 text-sm text-emerald-200" style={{ background: "linear-gradient(135deg, rgba(52,211,153,0.06) 0%, rgba(52,211,153,0.02) 100%)" }}>
          <Icon name="check" className="h-4 w-4" />
          No discrepancies — all rule checks passed.
        </section>
      )}

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-[color:var(--border)] px-5 py-3">
          <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-100">
            Line Items
            <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-xs font-medium text-zinc-300">
              {items.length}
            </span>
          </h2>
        </div>
        {items.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-zinc-500">No line items.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[color:var(--border)] bg-white/[0.02] text-left">
                  {itemColumns.map((c) => (
                    <th
                      key={c}
                      className="px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-zinc-500"
                    >
                      {c.replace(/_/g, " ")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((row, i) => (
                  <tr key={i} className="border-b border-white/[0.04] last:border-0 transition-colors hover:bg-white/[0.03]">
                    {itemColumns.map((c) => (
                      <td key={c} className="px-4 py-2.5 align-top tabular-nums text-zinc-300">
                        {String(row[c] ?? "—")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {data.human_report && (
        <section className="card p-5">
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-zinc-100">
            <Icon name="info" className="h-4 w-4 text-violet-300" /> Agent Report
          </h2>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">
            {data.human_report}
          </p>
        </section>
      )}

      {needsReview && status !== "approved" && status !== "rejected" && (
        <section className="card border-amber-500/30 p-5" style={{ background: "linear-gradient(135deg, rgba(251,191,36,0.08) 0%, rgba(251,191,36,0.02) 100%)" }}>
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15 text-amber-200 ring-1 ring-inset ring-amber-500/30">
              <Icon name="alert" className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-amber-100">Human Review Required</h2>
              <p className="text-xs text-amber-200/70">
                The pipeline is paused awaiting your decision.
              </p>
            </div>
          </div>
          <textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Correction notes / remarks (optional)"
            className="mb-3 h-24 w-full rounded-lg border border-amber-500/30 bg-white/[0.03] px-3 py-2 text-sm text-amber-50 placeholder:text-amber-200/40 focus:border-amber-400/50 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
          />
          <div className="flex flex-wrap gap-2">
            <button
              disabled={submitting}
              onClick={() => decide("accept")}
              className="btn-success"
            >
              {submitting ? <Spinner /> : <Icon name="check" />} Approve
            </button>
            <button
              disabled={submitting}
              onClick={() => decide("reject")}
              className="btn-danger"
            >
              {submitting ? <Spinner /> : <Icon name="x" />} Reject
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function InvoicePreviewButton({ name }: { name: string }) {
  const [open, setOpen] = useState(false);
  const url = invoiceFileUrl(name);
  const ext = name.toLowerCase().slice(name.lastIndexOf("."));
  const isImage = [".png", ".jpg", ".jpeg"].includes(ext);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="btn-ghost"
        title="Preview original document"
      >
        <Icon name="file" className="h-4 w-4" /> Preview Document
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="relative flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-card)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            style={{ boxShadow: "0 30px 80px -20px rgba(0,0,0,0.8), 0 0 60px -20px rgb(167 139 250 / 0.3)" }}
          >
            <div className="flex items-center justify-between border-b border-[color:var(--border)] px-4 py-2.5">
              <div className="flex items-center gap-2 truncate text-sm font-medium text-zinc-100">
                <Icon name="file" className="h-4 w-4 text-violet-300" />
                <span className="truncate">{name}</span>
              </div>
              <div className="flex items-center gap-3">
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-violet-300"
                >
                  <Icon name="external" className="h-3 w-3" /> Open in tab
                </a>
                <button
                  onClick={() => setOpen(false)}
                  className="text-zinc-400 hover:text-zinc-100"
                  aria-label="close"
                >
                  <Icon name="x" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto bg-black/40">
              {isImage ? (
                <img
                  src={url}
                  alt={name}
                  className="mx-auto h-full max-h-full object-contain"
                />
              ) : (
                <iframe src={url} title={name} className="h-full w-full" />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Field({ label, value }: { label: string; value: any }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-medium uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-1 truncate text-sm font-medium text-zinc-100">{value ?? "—"}</div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="skeleton h-5 w-32" />
      <div className="card space-y-4 p-5">
        <div className="flex items-center gap-3">
          <div className="skeleton h-12 w-12 rounded-xl" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-5 w-2/3" />
            <div className="skeleton h-4 w-1/3" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-2">
              <div className="skeleton h-3 w-16" />
              <div className="skeleton h-4 w-24" />
            </div>
          ))}
        </div>
      </div>
      <div className="skeleton h-32" />
    </div>
  );
}
