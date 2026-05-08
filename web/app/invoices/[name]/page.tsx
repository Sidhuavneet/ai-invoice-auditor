"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getInvoice, submitDecision } from "@/lib/api";

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
      const refreshed = await getInvoice(name);
      setData(refreshed);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <p className="text-zinc-500">Loading…</p>;
  if (error)
    return (
      <pre className="whitespace-pre-wrap rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
        {error}
      </pre>
    );
  if (!data) return <p>Not found.</p>;

  const header = data.header || {};
  const items: LineItem[] = data.line_item || [];
  const summary: string[] =
    data.discrepancy_report?.discrepancy_summary || [];
  const status = (data.status || "").toLowerCase().trim();
  const recommendation = (data.recommendation || "").toLowerCase().trim();
  const needsReview = status === "manual review" || recommendation === "manual review";

  const itemColumns =
    items.length > 0 ? Object.keys(items[0]) : [];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-sm text-blue-600 hover:underline">
          ← Back to dashboard
        </Link>
      </div>

      <header className="rounded-lg border border-zinc-200 bg-white p-5">
        <h1 className="text-xl font-semibold">{name}</h1>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
          <Field label="Invoice #" value={header.invoice_no} />
          <Field label="Date" value={header.invoice_date} />
          <Field label="Vendor" value={header.vendor_id} />
          <Field label="PO Reference" value={header.po_reference} />
          <Field label="Currency" value={header.currency} />
          <Field label="Total" value={header.total_amount} />
          <Field label="Recommendation" value={data.recommendation} />
          <Field label="Status" value={data.status} />
        </div>
      </header>

      <section className="rounded-lg border border-zinc-200 bg-white p-5">
        <h2 className="mb-3 text-lg font-semibold">Line Items</h2>
        {items.length === 0 ? (
          <p className="text-sm text-zinc-500">No line items.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  {itemColumns.map((c) => (
                    <th key={c} className="px-2 py-2 font-medium text-zinc-600">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((row, i) => (
                  <tr key={i} className="border-b last:border-0">
                    {itemColumns.map((c) => (
                      <td key={c} className="px-2 py-2 align-top">
                        {String(row[c] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-5">
        <h2 className="mb-3 text-lg font-semibold">Discrepancies</h2>
        {summary.length === 0 ? (
          <p className="text-sm text-emerald-700">No discrepancies found.</p>
        ) : (
          <ul className="list-disc space-y-1 pl-6 text-sm text-rose-800">
            {(Array.isArray(summary) ? summary : [summary]).map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        )}
      </section>

      {data.human_report && (
        <section className="rounded-lg border border-zinc-200 bg-white p-5">
          <h2 className="mb-3 text-lg font-semibold">Report</h2>
          <p className="whitespace-pre-wrap text-sm text-zinc-700">
            {data.human_report}
          </p>
        </section>
      )}

      {needsReview && status !== "accept" && status !== "reject" && (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-5">
          <h2 className="mb-3 text-lg font-semibold text-amber-900">
            Human Review
          </h2>
          <textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Correction notes / remarks"
            className="mb-3 h-24 w-full rounded border border-amber-300 bg-white px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              disabled={submitting}
              onClick={() => decide("accept")}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              Approve
            </button>
            <button
              disabled={submitting}
              onClick={() => decide("reject")}
              className="rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-60"
            >
              Reject
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="text-zinc-900">{value ?? "—"}</div>
    </div>
  );
}
