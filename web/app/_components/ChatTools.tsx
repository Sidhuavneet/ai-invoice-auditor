"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Icon, StatusPill, classifyStatus, formatCurrency } from "@/lib/ui";

/** Map a tool_result event (kind + payload) to a React component. The chat
 * message bubble walks over results in order and renders each. */
export function ToolResultRenderer({ kind, payload }: { kind: string; payload: any }) {
  switch (kind) {
    case "invoice":
      return <InvoiceCard inv={payload} />;
    case "vendor":
      return <VendorCard data={payload} />;
    case "invoice_list":
      return <InvoiceList title={payload.title} items={payload.items || []} />;
    case "overall_stats":
      return <OverallStatsCard data={payload} />;
    case "error":
      return (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-sm text-rose-200">
          <Icon name="alert" className="mr-1 inline h-3.5 w-3.5" /> {payload?.message || "Tool error"}
        </div>
      );
    default:
      return null;
  }
}

/** Small chip rendered while a tool is being executed but result not yet back. */
export function ToolCallChip({ name }: { name: string }) {
  const label = TOOL_LABELS[name] || name.replace(/_/g, " ");
  return (
    <motion.span
      initial={{ opacity: 0, y: -2 }}
      animate={{ opacity: 1, y: 0 }}
      className="inline-flex items-center gap-1.5 rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] font-medium text-violet-200 ring-1 ring-inset ring-violet-500/30"
      style={{ boxShadow: "0 0 12px -4px rgb(167 139 250 / 0.4)" }}
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-violet-400" />
      </span>
      Calling {label}
    </motion.span>
  );
}

const TOOL_LABELS: Record<string, string> = {
  get_invoice: "invoice lookup",
  get_vendor_stats: "vendor stats",
  list_flagged: "flagged invoices",
  get_overall_stats: "overall stats",
  search_invoices: "search",
};

/* ─── Invoice Card ─────────────────────────────────────────────────────── */

function InvoiceCard({ inv }: { inv: any }) {
  const summary = {
    file: inv.file_name,
    invoice_no: inv.invoice_no,
    invoice_date: inv.invoice_date,
    vendor: inv.vendor,
    currency: inv.currency,
    total: inv.total,
    recommendation: inv.recommendation,
    status: inv.status,
  };
  const href = inv.file_name ? `/invoices/${encodeURIComponent(inv.file_name + ".pdf")}` : "#";
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="card overflow-hidden"
    >
      <div className="flex items-start justify-between gap-3 border-b border-[color:var(--border)] p-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-zinc-500">
            <Icon name="file" className="h-3 w-3" />
            {inv.invoice_no || "Invoice"}
          </div>
          <div className="mt-0.5 truncate text-sm font-medium text-zinc-100">{inv.file_name}</div>
          <div className="mt-0.5 text-xs text-zinc-500">{inv.vendor || "—"}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-lg font-semibold tabular-nums text-zinc-100">
            {formatCurrency(inv.total, inv.currency)}
          </div>
          <div className="mt-1">
            <StatusPill kind={classifyStatus(summary as any)} />
          </div>
        </div>
      </div>
      {inv.reasons && inv.reasons.length > 0 && (
        <ul className="space-y-1 border-b border-[color:var(--border)] p-3 text-xs text-amber-100/80">
          {inv.reasons.slice(0, 3).map((r: string, i: number) => (
            <li key={i} className="flex items-start gap-1.5">
              <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-amber-400" /> {r}
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center justify-between p-2 text-[11px]">
        <span className="text-zinc-500">
          {inv.invoice_date || "no date"} · {inv.line_item_count || 0} line items
        </span>
        <Link
          href={href}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-violet-300 transition-colors hover:bg-violet-500/10 hover:text-violet-200"
        >
          Open <Icon name="arrow-right" className="h-3 w-3" />
        </Link>
      </div>
    </motion.div>
  );
}

/* ─── Invoice List ─────────────────────────────────────────────────────── */

function InvoiceList({ title, items }: { title: string; items: any[] }) {
  if (items.length === 0)
    return (
      <div className="card flex items-center gap-2 p-3 text-sm text-zinc-400">
        <Icon name="check" className="h-4 w-4 text-emerald-400" /> {title}: nothing matched.
      </div>
    );
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="card overflow-hidden"
    >
      <div className="flex items-center justify-between border-b border-[color:var(--border)] px-3 py-2 text-xs">
        <span className="font-medium uppercase tracking-wider text-zinc-400">{title}</span>
        <span className="text-zinc-600">{items.length}</span>
      </div>
      <ul className="divide-y divide-[color:var(--border)]">
        {items.map((inv, i) => {
          const summary = {
            file: inv.file_name,
            invoice_no: inv.invoice_no,
            vendor: inv.vendor,
            currency: inv.currency,
            total: inv.total,
            recommendation: inv.recommendation,
            status: inv.status,
          };
          const href = inv.file_name ? `/invoices/${encodeURIComponent(inv.file_name + ".pdf")}` : "#";
          return (
            <motion.li
              key={inv.file_name || i}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2, delay: i * 0.04 }}
              className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
            >
              <Link href={href} className="flex min-w-0 items-center gap-2 hover:text-violet-300">
                <Icon name="file" className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                <span className="truncate text-zinc-100">{inv.file_name}</span>
                <span className="hidden truncate text-zinc-500 md:inline">· {inv.vendor || "—"}</span>
              </Link>
              <div className="flex shrink-0 items-center gap-2">
                <span className="tabular-nums text-zinc-300">
                  {formatCurrency(inv.total, inv.currency)}
                </span>
                <StatusPill kind={classifyStatus(summary as any)} />
              </div>
            </motion.li>
          );
        })}
      </ul>
    </motion.div>
  );
}

/* ─── Vendor Card ──────────────────────────────────────────────────────── */

function VendorCard({ data }: { data: any }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="card overflow-hidden"
    >
      <div className="border-b border-[color:var(--border)] p-3">
        <div className="text-xs uppercase tracking-wider text-zinc-500">Vendor</div>
        <div className="mt-0.5 text-base font-semibold text-zinc-100">{data.vendor}</div>
      </div>
      <div className="grid grid-cols-3 gap-3 border-b border-[color:var(--border)] p-3 text-center">
        <Metric label="Spend" value={formatCurrency(data.total_spend, data.currency)} />
        <Metric label="Invoices" value={String(data.invoice_count)} />
        <Metric
          label="Approved"
          value={`${data.status_mix?.approved || 0}/${data.invoice_count}`}
        />
      </div>
      {data.invoices && data.invoices.length > 0 && (
        <ul className="divide-y divide-[color:var(--border)] text-sm">
          {data.invoices.map((inv: any) => (
            <li key={inv.file_name} className="flex items-center justify-between gap-2 px-3 py-2">
              <Link
                href={`/invoices/${encodeURIComponent(inv.file_name + ".pdf")}`}
                className="truncate text-zinc-200 hover:text-violet-300"
              >
                {inv.file_name}
              </Link>
              <span className="tabular-nums text-zinc-400">
                {formatCurrency(inv.total, inv.currency)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </motion.div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-zinc-100">{value}</div>
    </div>
  );
}

/* ─── Overall Stats Card ───────────────────────────────────────────────── */

function OverallStatsCard({ data }: { data: any }) {
  const k = data?.kpis || {};
  const totalSpend = Object.values(k.spend_by_currency || {}).reduce(
    (a: any, b: any) => a + b,
    0,
  );
  const primaryCurrency = Object.keys(k.spend_by_currency || { USD: 0 })[0] || "USD";
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="card overflow-hidden"
    >
      <div className="border-b border-[color:var(--border)] p-3 text-xs uppercase tracking-wider text-zinc-500">
        Overall stats
      </div>
      <div className="grid grid-cols-2 gap-3 p-3 md:grid-cols-4">
        <Metric label="Invoices" value={String(k.total_invoices ?? 0)} />
        <Metric
          label="Spend"
          value={formatCurrency(totalSpend as number, primaryCurrency)}
        />
        <Metric label="Auto-approval" value={`${k.auto_approval_rate ?? 0}%`} />
        <Metric label="Manual review" value={String(k.manual_review ?? 0)} />
      </div>
      {data?.top_vendors?.length > 0 && (
        <>
          <div className="border-t border-[color:var(--border)] px-3 py-1.5 text-[11px] uppercase tracking-wider text-zinc-500">
            Top vendors
          </div>
          <ul className="divide-y divide-[color:var(--border)] text-sm">
            {data.top_vendors.slice(0, 4).map((v: any) => (
              <li key={v.vendor} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="truncate text-zinc-200">{v.vendor}</span>
                <span className="tabular-nums text-zinc-400">
                  {formatCurrency(v.spend, v.currency || primaryCurrency)} · {v.count}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </motion.div>
  );
}
