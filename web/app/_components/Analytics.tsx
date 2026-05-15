"use client";

import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import type { EChartsOption } from "echarts";
import type { StatsResponse } from "@/lib/api";
import { Icon } from "@/lib/ui";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

// Reserve the violet→cyan gradient ONLY for AI-generated UI elements (insights,
// summaries). Raw data tiles use neutral palette — convention from Notion AI /
// Linear Asks that visually separates "ground truth" from "AI output".
const AI_GRADIENT = "linear-gradient(135deg, rgb(167,139,250) 0%, rgb(34,211,238) 100%)";

function fmtMoney(n: number, currency = "USD") {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${currency} ${n.toFixed(0)}`;
  }
}

function fmtNumber(n: number) {
  return new Intl.NumberFormat("en-US").format(n);
}

export function AnalyticsView({ stats }: { stats: StatsResponse | null }) {
  if (!stats) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="skeleton h-24 rounded-xl" />
        ))}
      </div>
    );
  }

  const k = stats.kpis;
  const primaryCurrency =
    Object.entries(k.spend_by_currency).sort((a, b) => b[1] - a[1])[0]?.[0] || "USD";
  const totalSpend = Object.values(k.spend_by_currency).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-4">
      {/* Hero KPI strip */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <KpiTile
          label="Invoices"
          value={fmtNumber(k.total_invoices)}
          icon="file"
          accent="violet"
          delay={0}
        />
        <KpiTile
          label="Total Spend"
          value={fmtMoney(totalSpend, primaryCurrency)}
          sub={Object.keys(k.spend_by_currency).length > 1 ? "multi-currency" : primaryCurrency}
          icon="chart"
          accent="cyan"
          delay={0.05}
        />
        <KpiTile
          label="Auto-approval"
          value={`${k.auto_approval_rate}%`}
          sub={`${k.approved} approved`}
          icon="check"
          accent="emerald"
          delay={0.1}
        />
        <KpiTile
          label="Manual Review"
          value={fmtNumber(k.manual_review)}
          sub={k.pending ? `${k.pending} pending` : "none pending"}
          icon="alert"
          accent="amber"
          delay={0.15}
        />
        <KpiTile
          label="Avg Confidence"
          value={`${k.avg_translation_confidence}%`}
          sub={`${k.total_line_items} line items`}
          icon="sparkles"
          accent="violet"
          delay={0.2}
        />
      </section>

      {/* Hero row: spend timeline (8col) + AI insights card (4col) */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <BentoCard className="lg:col-span-8" title="Spend over time" icon="chart" delay={0.25}>
          <SpendTimelineChart data={stats.spend_timeline} />
        </BentoCard>
        <BentoCard
          className="lg:col-span-4"
          title="AI Insights"
          icon="sparkles"
          accent="ai"
          delay={0.3}
        >
          <AiInsights stats={stats} />
        </BentoCard>
      </section>

      {/* Middle bento: vendor treemap + status donut + reasons + anomalies */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <BentoCard className="lg:col-span-6" title="Top vendors by spend" icon="chart" delay={0.35}>
          <VendorTreemap data={stats.top_vendors} />
        </BentoCard>
        <BentoCard className="lg:col-span-3" title="Status distribution" icon="check" delay={0.4}>
          <StatusDonut data={stats.status_distribution} />
        </BentoCard>
        <BentoCard className="lg:col-span-3" title="Discrepancy reasons" icon="alert" delay={0.45}>
          <ReasonsList data={stats.discrepancy_reasons} />
        </BentoCard>
      </section>

      {/* Anomalies row */}
      {stats.anomalies.length > 0 && (
        <BentoCard title="Anomalies detected" icon="alert" accent="ai" delay={0.5}>
          <AnomaliesGrid anomalies={stats.anomalies} />
        </BentoCard>
      )}
    </div>
  );
}

/* ─── KPI Tile ─────────────────────────────────────────────────────────── */

const accentColors = {
  violet: { glow: "rgb(167 139 250 / 0.4)", text: "text-violet-300", icon: "rgba(167,139,250,0.25)" },
  cyan: { glow: "rgb(34 211 238 / 0.4)", text: "text-cyan-300", icon: "rgba(34,211,238,0.25)" },
  emerald: { glow: "rgb(52 211 153 / 0.4)", text: "text-emerald-300", icon: "rgba(52,211,153,0.25)" },
  amber: { glow: "rgb(251 191 36 / 0.35)", text: "text-amber-200", icon: "rgba(251,191,36,0.25)" },
  rose: { glow: "rgb(244 63 94 / 0.4)", text: "text-rose-300", icon: "rgba(244,63,94,0.25)" },
} as const;

function KpiTile({
  label,
  value,
  sub,
  icon,
  accent,
  delay = 0,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: any;
  accent: keyof typeof accentColors;
  delay?: number;
}) {
  const a = accentColors[accent];
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: [0.2, 0.8, 0.2, 1] }}
      className="card card-hover relative overflow-hidden p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
            {label}
          </div>
          <div className={`mt-1 text-2xl font-semibold tabular-nums ${a.text}`}>{value}</div>
          {sub && <div className="mt-0.5 text-[11px] text-zinc-500">{sub}</div>}
        </div>
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${a.text}`}
          style={{
            background: a.icon,
            border: `1px solid ${a.glow.replace("/ 0.4", "/ 0.3")}`,
            boxShadow: `0 0 16px -4px ${a.glow}`,
          }}
        >
          <Icon name={icon} className="h-4 w-4" />
        </div>
      </div>
    </motion.div>
  );
}

/* ─── Bento card shell ─────────────────────────────────────────────────── */

function BentoCard({
  title,
  icon,
  children,
  className = "",
  accent,
  delay = 0,
}: {
  title: string;
  icon?: any;
  children: React.ReactNode;
  className?: string;
  accent?: "ai";
  delay?: number;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: [0.2, 0.8, 0.2, 1] }}
      className={`card relative overflow-hidden ${className}`}
      style={
        accent === "ai"
          ? { boxShadow: "0 0 0 1px rgba(167,139,250,0.25), 0 8px 32px -16px rgba(0,0,0,0.5), 0 0 32px -12px rgb(167 139 250 / 0.25)" }
          : undefined
      }
    >
      {accent === "ai" && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{ background: AI_GRADIENT }}
        />
      )}
      <header className="flex items-center justify-between border-b border-[color:var(--border)] px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm font-medium text-zinc-100">
          {icon && (
            <Icon
              name={icon}
              className={`h-4 w-4 ${accent === "ai" ? "text-violet-300" : "text-zinc-500"}`}
            />
          )}
          {title}
          {accent === "ai" && (
            <span
              className="ml-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white"
              style={{ background: AI_GRADIENT }}
            >
              AI
            </span>
          )}
        </div>
      </header>
      <div className="p-4">{children}</div>
    </motion.section>
  );
}

/* ─── Charts ───────────────────────────────────────────────────────────── */

function SpendTimelineChart({ data }: { data: { date: string; amount: number }[] }) {
  if (data.length === 0)
    return <EmptyState text="No dated invoices yet." />;
  const option: EChartsOption = {
    grid: { left: 50, right: 10, top: 10, bottom: 30 },
    tooltip: {
      trigger: "axis",
      backgroundColor: "#101016",
      borderColor: "#1f1f2a",
      textStyle: { color: "#ededf2" },
    },
    xAxis: {
      type: "category",
      data: data.map((d) => d.date),
      axisLabel: { color: "#8b8b9a", fontSize: 10 },
      axisLine: { lineStyle: { color: "#27272a" } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: "#8b8b9a", fontSize: 10 },
      splitLine: { lineStyle: { color: "#1f1f2a" } },
    },
    series: [
      {
        data: data.map((d) => d.amount),
        type: "line",
        smooth: true,
        symbol: "circle",
        symbolSize: 6,
        lineStyle: { width: 2, color: "#a78bfa" },
        itemStyle: { color: "#a78bfa", borderColor: "#0f0f14", borderWidth: 2 },
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(167,139,250,0.4)" },
              { offset: 1, color: "rgba(167,139,250,0)" },
            ],
          },
        },
      },
    ],
  };
  return <ReactECharts option={option} style={{ height: 260 }} theme="dark" />;
}

function VendorTreemap({ data }: { data: StatsResponse["top_vendors"] }) {
  if (data.length === 0) return <EmptyState text="No vendor data yet." />;
  const palette = ["#a78bfa", "#22d3ee", "#34d399", "#fbbf24", "#f472b6", "#60a5fa", "#fb923c", "#a3e635"];
  const option: EChartsOption = {
    tooltip: {
      backgroundColor: "#101016",
      borderColor: "#1f1f2a",
      textStyle: { color: "#ededf2" },
      formatter: (p: any) =>
        `<b>${p.name}</b><br/>Spend: ${fmtMoney(p.value as number, data[0]?.currency || "USD")}<br/>${p.data.invoiceCount} invoices`,
    },
    series: [
      {
        type: "treemap",
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        label: { color: "#ededf2", fontSize: 12, fontWeight: 600 },
        upperLabel: { show: false },
        itemStyle: { borderColor: "#0a0a0f", borderWidth: 2, gapWidth: 2 },
        data: data.map((d, i) => ({
          name: d.vendor,
          value: d.spend,
          invoiceCount: d.count,
          itemStyle: { color: palette[i % palette.length] + "cc" },
        })),
      },
    ],
  };
  return <ReactECharts option={option} style={{ height: 280 }} />;
}

function StatusDonut({ data }: { data: { status: string; count: number }[] }) {
  if (data.length === 0) return <EmptyState text="No data yet." />;
  const colorMap: Record<string, string> = {
    approved: "#34d399",
    rejected: "#f43f5e",
    manual_review: "#fbbf24",
    pending: "#71717a",
    error: "#fb7185",
    unknown: "#52525b",
  };
  const total = data.reduce((a, b) => a + b.count, 0);
  const option: EChartsOption = {
    tooltip: {
      backgroundColor: "#101016",
      borderColor: "#1f1f2a",
      textStyle: { color: "#ededf2" },
    },
    legend: {
      orient: "horizontal",
      bottom: 0,
      textStyle: { color: "#8b8b9a", fontSize: 10 },
      itemWidth: 8,
      itemHeight: 8,
    },
    series: [
      {
        type: "pie",
        radius: ["60%", "85%"],
        center: ["50%", "42%"],
        avoidLabelOverlap: true,
        label: { show: false },
        labelLine: { show: false },
        data: data.map((d) => ({
          name: d.status.replace(/_/g, " "),
          value: d.count,
          itemStyle: { color: colorMap[d.status] || "#52525b" },
        })),
      },
    ],
    graphic: [
      {
        type: "text",
        left: "center",
        top: "37%",
        style: { text: String(total), fill: "#ededf2", fontSize: 24, fontWeight: 600 },
      },
      {
        type: "text",
        left: "center",
        top: "47%",
        style: { text: "total", fill: "#5e5e6e", fontSize: 10 },
      },
    ],
  };
  return <ReactECharts option={option} style={{ height: 240 }} />;
}

function ReasonsList({ data }: { data: { reason: string; count: number }[] }) {
  if (data.length === 0)
    return (
      <div className="flex h-[240px] flex-col items-center justify-center gap-2 text-center text-sm">
        <Icon name="check" className="h-6 w-6 text-emerald-400" />
        <span className="text-zinc-400">No discrepancies found.</span>
      </div>
    );
  const max = Math.max(...data.map((d) => d.count));
  return (
    <ul className="space-y-2">
      {data.slice(0, 6).map((r) => (
        <li key={r.reason} className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-300">{r.reason}</span>
            <span className="tabular-nums text-zinc-500">{r.count}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.04]">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(r.count / max) * 100}%` }}
              transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
              className="h-full rounded-full"
              style={{ background: AI_GRADIENT }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function AnomaliesGrid({ anomalies }: { anomalies: StatsResponse["anomalies"] }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
      {anomalies.map((a, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3, delay: i * 0.04 }}
          className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-3"
        >
          <div className="flex items-start gap-2">
            <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-zinc-100">{a.file || a.vendor || "Anomaly"}</div>
              <div className="mt-0.5 text-xs text-zinc-400">{a.reason}</div>
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex h-[240px] items-center justify-center text-sm text-zinc-500">{text}</div>
  );
}

/* ─── AI Insights (placeholder until backend wired) ───────────────────── */

function AiInsights({ stats }: { stats: StatsResponse }) {
  const k = stats.kpis;
  const topVendor = stats.top_vendors[0];
  const topReason = stats.discrepancy_reasons[0];
  const anomalyCount = stats.anomalies.length;

  // Deterministic narrative now; will be LLM-generated later (tool-calling
  // against /stats so the model never invents numbers).
  const bullets: { icon: any; text: string; tone: "good" | "warn" | "info" }[] = [];

  if (k.total_invoices === 0) {
    bullets.push({ icon: "info", tone: "info", text: "Upload an invoice to start auditing." });
  } else {
    bullets.push({
      icon: "check",
      tone: k.auto_approval_rate > 70 ? "good" : "info",
      text: `${k.auto_approval_rate}% of invoices auto-approved — ${
        k.auto_approval_rate > 70 ? "strong pipeline health" : "room to tune rules"
      }.`,
    });

    if (topVendor) {
      const totalSpend = Object.values(k.spend_by_currency).reduce((a, b) => a + b, 0);
      const pct = totalSpend ? ((topVendor.spend / totalSpend) * 100).toFixed(0) : "0";
      bullets.push({
        icon: "chart",
        tone: parseInt(pct) > 50 ? "warn" : "info",
        text: `${topVendor.vendor} accounts for ${pct}% of total spend across ${topVendor.count} invoices.`,
      });
    }

    if (topReason) {
      bullets.push({
        icon: "alert",
        tone: "warn",
        text: `"${topReason.reason}" is the most common discrepancy (${topReason.count} occurrence${topReason.count === 1 ? "" : "s"}).`,
      });
    }

    if (anomalyCount > 0) {
      bullets.push({
        icon: "alert",
        tone: "warn",
        text: `${anomalyCount} unusual invoice${anomalyCount === 1 ? "" : "s"} flagged — review the anomalies panel below.`,
      });
    } else if (k.total_invoices > 5) {
      bullets.push({
        icon: "check",
        tone: "good",
        text: "No statistical outliers detected across vendor histories.",
      });
    }

    if (k.manual_review > 0) {
      bullets.push({
        icon: "clock",
        tone: "warn",
        text: `${k.manual_review} invoice${k.manual_review === 1 ? "" : "s"} awaiting human review.`,
      });
    }
  }

  const toneCls: Record<string, string> = {
    good: "text-emerald-300",
    warn: "text-amber-200",
    info: "text-zinc-300",
  };

  return (
    <ul className="space-y-2.5">
      {bullets.map((b, i) => (
        <motion.li
          key={i}
          initial={{ opacity: 0, x: -4 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3, delay: i * 0.06 }}
          className="flex items-start gap-2 text-sm"
        >
          <Icon name={b.icon} className={`mt-0.5 h-4 w-4 shrink-0 ${toneCls[b.tone]}`} />
          <span className="text-zinc-200">{b.text}</span>
        </motion.li>
      ))}
      <li className="pt-1 text-[11px] text-zinc-500">
        Auto-generated from your data. Refreshes when invoices change.
      </li>
    </ul>
  );
}
