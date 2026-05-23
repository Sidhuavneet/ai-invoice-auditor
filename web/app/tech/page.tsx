"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Icon } from "@/lib/ui";
import { getStats, type StatsResponse } from "@/lib/api";

/* ─── Data ────────────────────────────────────────────────────────────────
 *
 * Everything on this page is driven by the constants below so the source of
 * truth is one file. If a new tool gets added to the project, add a row here
 * and it shows up in the pipeline, the bento, and the flow map automatically.
 */

type AgentStage = {
  id: string;
  label: string;
  blurb: string;
  uses: string[]; // tech keys
  color: string;
};

const STAGES: AgentStage[] = [
  {
    id: "extract",
    label: "Extract",
    blurb: "Reads PDFs, DOCX, and OCR'd scans into typed JSON.",
    uses: ["langgraph", "pydantic", "groq", "tesseract", "pdfplumber"],
    color: "#a78bfa",
  },
  {
    id: "translate",
    label: "Translate",
    blurb: "Detects language and normalises multilingual invoices to English.",
    uses: ["langgraph", "groq"],
    color: "#22d3ee",
  },
  {
    id: "validate",
    label: "Validate",
    blurb: "Math checks, currency rules, future-date guards.",
    uses: ["langgraph"],
    color: "#34d399",
  },
  {
    id: "audit",
    label: "Audit",
    blurb: "Generates the recommendation (approve / reject / manual review).",
    uses: ["langgraph", "groq"],
    color: "#fbbf24",
  },
  {
    id: "human",
    label: "Human",
    blurb: "Pauses for human approval when the policy flags it.",
    uses: ["langgraph", "sqlite"],
    color: "#f472b6",
  },
  {
    id: "save",
    label: "Save",
    blurb: "Writes report JSON atomically and indexes vectors to Chroma Cloud.",
    uses: ["chromadb", "huggingface", "langgraph"],
    color: "#60a5fa",
  },
];

type Tech = {
  key: string;
  name: string;
  group: "agent" | "llm" | "vector" | "frontend" | "backend" | "observability" | "io" | "guard";
  blurb: string;
  where: string[];
};

const TECH: Tech[] = [
  // Agent + orchestration
  {
    key: "langgraph",
    name: "LangGraph",
    group: "agent",
    blurb: "Wires the 6 agents into a state machine with pause/resume.",
    where: ["graph.py", "every agent node"],
  },
  {
    key: "langchain",
    name: "LangChain",
    group: "agent",
    blurb: "Provides bind_tools and with_structured_output helpers.",
    where: ["chat/stream", "extractor"],
  },
  {
    key: "pydantic",
    name: "Pydantic",
    group: "agent",
    blurb: "Schema validates every LLM output; auto-retries on bad JSON.",
    where: ["extractor_agent.py"],
  },
  {
    key: "mcp",
    name: "MCP Server",
    group: "agent",
    blurb: "Exposes 12 invoice tools to Claude Desktop, Cursor, Zed.",
    where: ["mcp_server.py"],
  },

  // LLM
  {
    key: "groq",
    name: "Groq Llama 3.3",
    group: "llm",
    blurb: "70B reasoning model behind extraction, audit, chat synthesis.",
    where: ["llm_gateway.py", "chat/stream", "extractor"],
  },
  {
    key: "huggingface",
    name: "HuggingFace",
    group: "llm",
    blurb: "all-MiniLM-L6-v2 sentence-transformer for chunk embeddings.",
    where: ["embeddings.py"],
  },

  // Vector + memory
  {
    key: "chromadb",
    name: "ChromaDB Cloud",
    group: "vector",
    blurb: "Hosted vector DB; stores chunk embeddings for RAG.",
    where: ["server.py /chat/stream", "indexer"],
  },
  {
    key: "sqlite",
    name: "SQLite",
    group: "vector",
    blurb: "LangGraph checkpoints — pipeline survives restarts.",
    where: ["state_memory.db"],
  },

  // Observability
  {
    key: "langsmith",
    name: "LangSmith",
    group: "observability",
    blurb: "Auto-traces every agent node and LLM call.",
    where: ["env-driven, zero code changes"],
  },
  {
    key: "sse",
    name: "SSE Streaming",
    group: "observability",
    blurb: "Streams per-agent events and chat tokens live to the UI.",
    where: ["/process/stream", "/chat/stream"],
  },

  // I/O readers
  {
    key: "pdfplumber",
    name: "pdfplumber + pypdf",
    group: "io",
    blurb: "Two-tier PDF text extraction with layout-aware fallback.",
    where: ["read_pdf.py"],
  },
  {
    key: "tesseract",
    name: "Tesseract OCR",
    group: "io",
    blurb: "Reads scanned-image invoices via pytesseract.",
    where: ["read_images.py"],
  },
  {
    key: "docx",
    name: "python-docx",
    group: "io",
    blurb: "Parses .docx invoice tables and paragraphs.",
    where: ["read_docx.py"],
  },

  // Backend
  {
    key: "fastapi",
    name: "FastAPI",
    group: "backend",
    blurb: "ASGI backend exposing /process, /chat, /stats, /upload.",
    where: ["api/server.py"],
  },
  {
    key: "httpx",
    name: "httpx",
    group: "backend",
    blurb: "MCP server talks back to FastAPI over HTTP.",
    where: ["mcp_server.py"],
  },

  // Frontend
  {
    key: "nextjs",
    name: "Next.js 14",
    group: "frontend",
    blurb: "App Router; dashboard, chat, tech, invoice detail pages.",
    where: ["web/app/*"],
  },
  {
    key: "tailwind",
    name: "Tailwind CSS",
    group: "frontend",
    blurb: "Dark theme with violet→cyan AI-reserved gradient accent.",
    where: ["globals.css"],
  },
  {
    key: "framer",
    name: "Framer Motion",
    group: "frontend",
    blurb: "Page transitions, streaming pulses, stagger animations.",
    where: ["all _components"],
  },
  {
    key: "echarts",
    name: "Apache ECharts",
    group: "frontend",
    blurb: "Treemap, donut, area chart on the analytics dashboard.",
    where: ["Analytics.tsx"],
  },
  {
    key: "cmdk",
    name: "cmdk",
    group: "frontend",
    blurb: "Slash command palette in chat (/flagged, /vendor, …).",
    where: ["SlashPalette.tsx"],
  },

  // Guardrails
  {
    key: "guardrails",
    name: "Guardrails",
    group: "guard",
    blurb: "PII redaction, prompt-injection block, off-topic gate on chat I/O.",
    where: ["api/guardrails.py"],
  },
];

const GROUPS: { id: Tech["group"]; label: string; color: string }[] = [
  { id: "agent", label: "Agent Framework", color: "#a78bfa" },
  { id: "llm", label: "LLM + Embeddings", color: "#22d3ee" },
  { id: "vector", label: "Vector + Memory", color: "#34d399" },
  { id: "observability", label: "Observability", color: "#fbbf24" },
  { id: "io", label: "Document I/O", color: "#f472b6" },
  { id: "backend", label: "Backend", color: "#60a5fa" },
  { id: "frontend", label: "Frontend", color: "#c4b5fd" },
  { id: "guard", label: "Guardrails", color: "#fb7185" },
];

/* ─── Page ──────────────────────────────────────────────────────────────── */

export default function TechPage() {
  return (
    <div className="space-y-10 pb-12">
      <Header />
      <LiveImpactBand />
      <PipelineHero />
      <StackOverview />
      <TechBento />
      <FlowMap />
      <StatsFooter />
    </div>
  );
}

function Header() {
  const badges = [
    "Multi-agent",
    "LangGraph",
    "Groq Llama 3.3",
    "RAG",
    "HITL",
    "MCP",
    "Function-calling",
    "Streaming SSE",
    "Postgres",
  ];
  return (
    <motion.header
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-violet-300">
        <Icon name="sparkles" className="h-3.5 w-3.5" />
        Multi-agent · LangGraph · MCP-ready · Production architecture
      </div>
      <h1 className="mt-1 bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-3xl font-semibold tracking-tight text-transparent">
        Agentic invoice auditor. Auto-approves the clean ones, escalates only edge cases.
      </h1>
      <p className="mt-1 max-w-2xl text-sm text-zinc-500">
        Six specialised agents orchestrated in LangGraph extract, translate, validate, audit, and
        save each invoice — with human-in-the-loop on flagged ones and a RAG chat over the corpus.
        Numbers below are pulled live from the running system, not hardcoded.
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {badges.map((b, i) => (
          <motion.span
            key={b}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.1 + i * 0.03 }}
            className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-[11px] font-medium text-zinc-300"
          >
            {b}
          </motion.span>
        ))}
      </div>
    </motion.header>
  );
}

/* ─── LIVE IMPACT BAND — outcome metrics fetched from /stats ──────────── */

function LiveImpactBand() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getStats()
      .then((s) => !cancelled && setStats(s))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const k = stats?.kpis;
  const totalSpend = k
    ? Object.entries(k.spend_by_currency || {}).reduce<{ amount: number; currency: string }>(
        (acc, [cur, amt]) => (amt > acc.amount ? { amount: amt, currency: cur } : acc),
        { amount: 0, currency: "" },
      )
    : { amount: 0, currency: "" };

  const cards = [
    {
      label: "Auto-approved",
      value: k ? `${k.auto_approval_rate.toFixed(0)}%` : "—",
      sub: "Cleared without human touch",
      accent: "#34d399",
    },
    {
      label: "Invoices audited",
      value: k ? k.total_invoices.toLocaleString() : "—",
      sub: k ? `${k.total_line_items.toLocaleString()} line items parsed` : "Loading from /stats",
      accent: "#a78bfa",
    },
    {
      label: "Spend analyzed",
      value: totalSpend.amount
        ? `${totalSpend.currency} ${totalSpend.amount.toLocaleString(undefined, {
            maximumFractionDigits: 0,
          })}`
        : "—",
      sub: "Across all processed invoices",
      accent: "#22d3ee",
    },
    {
      label: "Flagged for review",
      value: k ? `${k.manual_review + k.rejected}` : "—",
      sub: k ? `${k.manual_review} manual · ${k.rejected} rejected` : "Only the edge cases",
      accent: "#fbbf24",
    },
  ];

  return (
    <section>
      <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
        </span>
        {error ? "Live metrics offline" : "Live impact · from the running system"}
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {cards.map((c, i) => (
          <motion.div
            key={c.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: i * 0.04 }}
            className="card relative overflow-hidden p-4"
            style={{ borderColor: `${c.accent}30` }}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-px"
              style={{ background: `linear-gradient(90deg, transparent, ${c.accent}, transparent)` }}
            />
            <div
              className="text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: c.accent }}
            >
              {c.label}
            </div>
            <div className="mt-1 bg-gradient-to-r from-white to-zinc-300 bg-clip-text text-3xl font-semibold tabular-nums text-transparent">
              {c.value}
            </div>
            <div className="mt-0.5 text-[11px] text-zinc-500">{c.sub}</div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

/* ─── 1. PIPELINE HERO — animated dot travelling through 6 agents ───── */

function PipelineHero() {
  const [active, setActive] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);

  // Auto-advance the "running" indicator unless the user hovers.
  useEffect(() => {
    if (hovered !== null) return;
    const t = setInterval(() => setActive((a) => (a + 1) % STAGES.length), 1800);
    return () => clearInterval(t);
  }, [hovered]);

  const focus = hovered ?? active;
  const stage = STAGES[focus];

  return (
    <section className="card relative overflow-hidden p-5">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ background: "linear-gradient(135deg, rgb(167,139,250) 0%, rgb(34,211,238) 100%)" }}
      />
      <div className="mb-4 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-zinc-400">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-violet-400" />
        </span>
        Live pipeline — how an invoice flows
      </div>

      {/* Stage chips with a travelling pulse on the connector */}
      <div className="relative flex items-center justify-between gap-2">
        {STAGES.map((s, i) => {
          const isFocus = i === focus;
          const isPast = i < focus;
          return (
            <div key={s.id} className="flex flex-1 items-center gap-2">
              <button
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                className="group flex flex-1 flex-col items-center gap-1.5"
              >
                <motion.div
                  layout
                  className="flex h-12 w-12 items-center justify-center rounded-xl text-xs font-semibold"
                  animate={{
                    scale: isFocus ? 1.1 : 1,
                    backgroundColor: isFocus
                      ? `${s.color}25`
                      : isPast
                        ? `${s.color}15`
                        : "rgba(255,255,255,0.03)",
                  }}
                  style={{
                    color: isFocus || isPast ? s.color : "#5e5e6e",
                    border: `1px solid ${isFocus ? s.color + "60" : isPast ? s.color + "30" : "rgba(255,255,255,0.08)"}`,
                    boxShadow: isFocus ? `0 0 24px -6px ${s.color}80` : "none",
                  }}
                >
                  {isPast || isFocus ? (
                    isFocus ? (
                      <span className="relative flex h-2 w-2">
                        <span
                          className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
                          style={{ backgroundColor: s.color }}
                        />
                        <span
                          className="relative inline-flex h-2 w-2 rounded-full"
                          style={{ backgroundColor: s.color }}
                        />
                      </span>
                    ) : (
                      <Icon name="check" className="h-4 w-4" />
                    )
                  ) : (
                    <span className="text-[11px] text-zinc-500">{i + 1}</span>
                  )}
                </motion.div>
                <div className="text-[11px] font-medium text-zinc-300">{s.label}</div>
              </button>
              {i < STAGES.length - 1 && (
                <div className="relative h-px flex-1 overflow-hidden bg-white/[0.06]">
                  <motion.div
                    className="absolute inset-y-0 left-0 w-full"
                    initial={false}
                    animate={{
                      background: i < focus
                        ? `linear-gradient(90deg, ${STAGES[i].color}80, ${STAGES[i + 1].color}80)`
                        : "transparent",
                    }}
                    transition={{ duration: 0.4 }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Detail panel for the focused stage */}
      <motion.div
        key={stage.id}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="mt-5 rounded-xl border border-[color:var(--border)] bg-white/[0.02] p-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wider" style={{ color: stage.color }}>
              Step {focus + 1} of {STAGES.length}
            </div>
            <div className="mt-0.5 text-base font-semibold text-zinc-100">{stage.label}</div>
            <p className="mt-1 text-sm text-zinc-400">{stage.blurb}</p>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
            {stage.uses.map((k) => {
              const t = TECH.find((x) => x.key === k);
              return t ? (
                <span
                  key={k}
                  className="rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset"
                  style={{
                    background: `${stage.color}15`,
                    color: stage.color,
                    borderColor: `${stage.color}40`,
                  }}
                >
                  {t.name}
                </span>
              ) : null;
            })}
          </div>
        </div>
      </motion.div>
    </section>
  );
}

/* ─── 2. STACK OVERVIEW — group chips, click to scroll filter ───────── */

function StackOverview() {
  return (
    <section>
      <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-500">
        At a glance · 8 layers · {TECH.length} tools
      </h2>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {GROUPS.map((g, i) => {
          const techs = TECH.filter((t) => t.group === g.id);
          return (
            <motion.div
              key={g.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: i * 0.04 }}
              className="card p-3"
              style={{ borderColor: `${g.color}25` }}
            >
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: g.color }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: g.color }} />
                {g.label}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {techs.map((t) => (
                  <span
                    key={t.key}
                    className="rounded-md bg-white/[0.04] px-1.5 py-0.5 text-[11px] text-zinc-300"
                  >
                    {t.name}
                  </span>
                ))}
              </div>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}

/* ─── 3. TECH BENTO — every tool as a card with blurb + where ───────── */

function TechBento() {
  const [active, setActive] = useState<string | null>(null);

  return (
    <section>
      <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-500">
        The full stack — hover for details
      </h2>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {TECH.map((t, i) => {
          const g = GROUPS.find((x) => x.id === t.group)!;
          const isActive = active === t.key;
          return (
            <motion.div
              key={t.key}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: Math.min(i * 0.025, 0.4) }}
              onMouseEnter={() => setActive(t.key)}
              onMouseLeave={() => setActive(null)}
              className="card relative overflow-hidden p-3.5 transition-all"
              style={{
                borderColor: isActive ? `${g.color}55` : undefined,
                boxShadow: isActive ? `0 0 28px -8px ${g.color}50` : undefined,
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div
                    className="text-[10px] font-semibold uppercase tracking-wider"
                    style={{ color: g.color }}
                  >
                    {g.label}
                  </div>
                  <div className="mt-0.5 text-sm font-semibold text-zinc-100">{t.name}</div>
                </div>
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                  style={{
                    background: `${g.color}15`,
                    border: `1px solid ${g.color}30`,
                  }}
                >
                  <TechMark group={t.group} color={g.color} />
                </span>
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-zinc-400">{t.blurb}</p>
              <AnimatePresence>
                {isActive && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="mt-2 border-t border-[color:var(--border)] pt-2"
                  >
                    <div className="text-[10px] uppercase tracking-wider text-zinc-500">Used in</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {t.where.map((w) => (
                        <code
                          key={w}
                          className="rounded bg-white/[0.05] px-1.5 py-0.5 text-[10px] text-violet-200"
                        >
                          {w}
                        </code>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}

// Per-group monogram icon — no external image files needed.
function TechMark({ group, color }: { group: Tech["group"]; color: string }) {
  const map: Record<Tech["group"], any> = {
    agent: "sparkles",
    llm: "sparkles",
    vector: "chart",
    observability: "info",
    io: "file",
    backend: "play",
    frontend: "chat",
    guard: "alert",
  };
  return (
    <span style={{ color }}>
      <Icon name={map[group]} className="h-3.5 w-3.5" />
    </span>
  );
}

/* ─── 4. FLOW MAP — system architecture as an SVG diagram ───────────── */

function FlowMap() {
  return (
    <section className="card overflow-hidden p-5">
      <h2 className="mb-1 text-base font-semibold text-zinc-100">Where an invoice goes</h2>
      <p className="mb-4 text-xs text-zinc-500">
        Every box is a real file or service. Arrows show how data physically moves.
      </p>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
        {/* INPUT */}
        <FlowGroup
          label="1 · Input"
          accent="#a78bfa"
          items={[
            { name: "PDF / DOCX / PNG", sub: "drag-drop or /upload" },
            { name: "pdfplumber + pypdf", sub: "PDF text" },
            { name: "Tesseract OCR", sub: "scans" },
            { name: "python-docx", sub: "DOCX tables" },
          ]}
        />
        <FlowArrow />
        {/* PIPELINE */}
        <FlowGroup
          label="2 · Agents"
          accent="#22d3ee"
          items={[
            { name: "LangGraph", sub: "orchestrates 6 nodes" },
            { name: "Groq Llama 3.3", sub: "reasoning model" },
            { name: "Pydantic", sub: "structured outputs" },
            { name: "SQLite", sub: "HITL checkpoints" },
            { name: "LangSmith", sub: "traces everything" },
          ]}
        />
        <FlowArrow />
        {/* STORAGE + UI */}
        <FlowGroup
          label="3 · Storage + UI"
          accent="#34d399"
          items={[
            { name: "ChromaDB Cloud", sub: "vector embeddings" },
            { name: "HuggingFace", sub: "MiniLM embeddings" },
            { name: "FastAPI /stream", sub: "SSE telemetry" },
            { name: "Next.js + ECharts", sub: "dashboard + chat" },
            { name: "MCP Server", sub: "Claude Desktop link" },
          ]}
        />
      </div>
    </section>
  );
}

function FlowGroup({
  label,
  accent,
  items,
}: {
  label: string;
  accent: string;
  items: { name: string; sub: string }[];
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.4 }}
      className="rounded-xl border p-3"
      style={{ borderColor: `${accent}40`, background: `${accent}08` }}
    >
      <div
        className="text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: accent }}
      >
        {label}
      </div>
      <ul className="mt-2 space-y-1.5">
        {items.map((it) => (
          <li
            key={it.name}
            className="flex items-center justify-between gap-2 rounded-md bg-white/[0.04] px-2 py-1.5"
          >
            <span className="truncate text-[12px] font-medium text-zinc-100">{it.name}</span>
            <span className="truncate text-[10px] text-zinc-500">{it.sub}</span>
          </li>
        ))}
      </ul>
    </motion.div>
  );
}

function FlowArrow() {
  return (
    <div className="flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
        className="relative h-px w-full md:h-12 md:w-px"
      >
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(167,139,250,0.4), rgba(34,211,238,0.4))",
          }}
        />
        <motion.div
          className="absolute left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full"
          animate={{ top: ["0%", "100%"] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }}
          style={{
            background: "rgb(167,139,250)",
            boxShadow: "0 0 12px rgb(167 139 250 / 0.8)",
          }}
        />
      </motion.div>
    </div>
  );
}

/* ─── 5. STATS FOOTER — quick numbers ─────────────────────────────────── */

function StatsFooter() {
  const stats = [
    { k: "3", v: "Document formats — PDF, DOCX, scans" },
    { k: "3", v: "Languages — English, German, Spanish" },
    { k: "1-click", v: "Human review on flagged invoices" },
    { k: "0 loss", v: "Redeploys mid-pipeline — Postgres checkpoints" },
    { k: "RAG", v: "Natural-language Q&A across every invoice" },
    { k: "MCP", v: "Same tools usable from Claude Desktop, Cursor" },
  ];
  return (
    <section className="grid grid-cols-2 gap-2 md:grid-cols-6">
      {stats.map((s, i) => (
        <motion.div
          key={s.v}
          initial={{ opacity: 0, y: 6 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.3, delay: i * 0.04 }}
          className="card p-3 text-center"
        >
          <div className="bg-gradient-to-r from-violet-300 to-cyan-300 bg-clip-text text-2xl font-semibold tabular-nums text-transparent">
            {s.k}
          </div>
          <div className="mt-0.5 text-[10px] uppercase tracking-wider text-zinc-500">{s.v}</div>
        </motion.div>
      ))}
    </section>
  );
}
