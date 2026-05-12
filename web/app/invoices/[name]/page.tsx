"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getInvoice, submitDecision } from "@/lib/api";
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
          className="inline-flex items-center gap-1 text-sm text-stone-600 transition-colors hover:text-indigo-600"
        >
          <Icon name="arrow-left" /> Back to dashboard
        </Link>
        <span className="text-xs text-stone-400">Invoice report</span>
      </div>

      <header className="card overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-stone-200 p-5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-50 to-violet-50 text-indigo-600 ring-1 ring-inset ring-indigo-100">
              <Icon name="file" className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <h1 className="break-all text-xl font-semibold tracking-tight">{name}</h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <StatusPill kind={kind} />
                {data.recommendation && (
                  <span className="pill bg-stone-100 text-stone-600 ring-stone-200">
                    Recommended: {data.recommendation}
                  </span>
                )}
                {discrepancies.length > 0 && (
                  <span className="pill bg-amber-50 text-amber-700 ring-amber-200">
                    <Icon name="alert" className="h-3 w-3" /> {discrepancies.length} issue
                    {discrepancies.length === 1 ? "" : "s"}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wider text-stone-500">Total</div>
            <div className="mt-0.5 text-3xl font-semibold tabular-nums">
              {formatCurrency(header.total_amount, header.currency)}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 p-5 md:grid-cols-4">
          <Field label="Invoice #" value={header.invoice_no} />
          <Field label="Date" value={header.invoice_date} />
          <Field label="Vendor" value={header.vendor_id} />
          <Field label="PO Reference" value={header.po_reference} />
        </div>
      </header>

      {discrepancies.length > 0 && (
        <section className="card border-amber-200 bg-amber-50/30 p-5">
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-amber-900">
            <Icon name="alert" className="h-4 w-4" /> Discrepancies
          </h2>
          <ul className="space-y-2">
            {discrepancies.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-amber-900">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {discrepancies.length === 0 && (
        <section className="card flex items-center gap-2 border-emerald-200 bg-emerald-50/30 p-4 text-sm text-emerald-800">
          <Icon name="check" className="h-4 w-4" />
          No discrepancies — all rule checks passed.
        </section>
      )}

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            Line Items
            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600">
              {items.length}
            </span>
          </h2>
        </div>
        {items.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-stone-500">No line items.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 bg-stone-50/50 text-left">
                  {itemColumns.map((c) => (
                    <th
                      key={c}
                      className="px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-stone-500"
                    >
                      {c.replace(/_/g, " ")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((row, i) => (
                  <tr key={i} className="border-b border-stone-100 last:border-0 hover:bg-stone-50/60">
                    {itemColumns.map((c) => (
                      <td key={c} className="px-4 py-2.5 align-top text-stone-700 tabular-nums">
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
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
            <Icon name="info" className="h-4 w-4 text-indigo-500" /> Agent Report
          </h2>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-stone-700">
            {data.human_report}
          </p>
        </section>
      )}

      {needsReview && status !== "approved" && status !== "rejected" && (
        <section className="card border-amber-200 bg-gradient-to-br from-amber-50 to-amber-50/30 p-5">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
              <Icon name="alert" className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-amber-900">Human Review Required</h2>
              <p className="text-xs text-amber-800/80">
                The pipeline is paused awaiting your decision.
              </p>
            </div>
          </div>
          <textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Correction notes / remarks (optional)"
            className="mb-3 h-24 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm placeholder:text-amber-700/40 focus:outline-none focus:ring-2 focus:ring-amber-200"
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

function Field({ label, value }: { label: string; value: any }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-medium uppercase tracking-wider text-stone-500">{label}</div>
      <div className="mt-1 truncate text-sm font-medium text-stone-900">{value ?? "—"}</div>
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
