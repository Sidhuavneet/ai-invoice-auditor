"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Icon } from "@/lib/ui";

const STAGES = [
  { id: "extractor", label: "Extract" },
  { id: "translate", label: "Translate" },
  { id: "validation", label: "Validate" },
  { id: "reporting", label: "Audit" },
  { id: "final", label: "Save" },
] as const;

export type FileState = {
  file: string;
  doneNodes: Set<string>;
  status: "running" | "paused" | "done" | "error";
  finalStatus?: string;
  error?: string;
};

export function LivePipeline({ files }: { files: FileState[] }) {
  if (files.length === 0) return null;
  return (
    <motion.section
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.3 }}
      className="card relative overflow-hidden"
      style={{
        boxShadow:
          "0 0 0 1px rgba(167,139,250,0.25), 0 8px 32px -16px rgba(0,0,0,0.5), 0 0 40px -12px rgb(167 139 250 / 0.3)",
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ background: "linear-gradient(135deg, rgb(167,139,250) 0%, rgb(34,211,238) 100%)" }}
      />
      <header className="flex items-center justify-between border-b border-[color:var(--border)] px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm font-medium text-zinc-100">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-violet-400" />
          </span>
          Live pipeline
          <span
            className="ml-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white"
            style={{
              background: "linear-gradient(135deg, rgb(167,139,250) 0%, rgb(34,211,238) 100%)",
            }}
          >
            AI
          </span>
        </div>
        <span className="text-[11px] text-zinc-500">{files.length} in flight</span>
      </header>
      <ul className="divide-y divide-[color:var(--border)]">
        <AnimatePresence initial={false}>
          {files.map((f) => (
            <motion.li
              key={f.file}
              layout
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25 }}
              className="px-4 py-3"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2 text-sm text-zinc-100">
                  <Icon name="file" className="h-4 w-4 shrink-0 text-zinc-500" />
                  <span className="truncate">{f.file}</span>
                </div>
                <FileBadge state={f} />
              </div>
              <PipelineChips state={f} />
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </motion.section>
  );
}

function PipelineChips({ state }: { state: FileState }) {
  // Determine which stage is "currently running":
  // first stage whose id isn't in doneNodes, unless paused/done/error.
  const currentIdx =
    state.status === "running"
      ? STAGES.findIndex((s) => !state.doneNodes.has(s.id))
      : -1;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {STAGES.map((stage, i) => {
        const done = state.doneNodes.has(stage.id);
        const running = i === currentIdx;
        const reached = done || running;
        return (
          <div key={stage.id} className="flex items-center gap-1.5">
            <motion.span
              layout
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset transition-colors ${
                done
                  ? "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30"
                  : running
                    ? "bg-violet-500/15 text-violet-200 ring-violet-500/40"
                    : "bg-white/[0.03] text-zinc-500 ring-white/10"
              }`}
              style={
                running
                  ? { boxShadow: "0 0 16px -4px rgb(167 139 250 / 0.5)" }
                  : undefined
              }
            >
              {done ? (
                <Icon name="check" className="h-3 w-3" />
              ) : running ? (
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-violet-400" />
                </span>
              ) : (
                <span className="h-2 w-2 rounded-full bg-zinc-700" />
              )}
              {stage.label}
            </motion.span>
            {i < STAGES.length - 1 && (
              <span
                className={`h-px w-3 ${reached ? "bg-violet-500/40" : "bg-white/[0.05]"}`}
              />
            )}
          </div>
        );
      })}
      {state.status === "paused" && (
        <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-200 ring-1 ring-inset ring-amber-500/30">
          <Icon name="alert" className="h-3 w-3" /> Needs human review
        </span>
      )}
    </div>
  );
}

function FileBadge({ state }: { state: FileState }) {
  if (state.status === "error")
    return (
      <span className="pill bg-rose-500/10 text-rose-300 ring-rose-500/30">
        <Icon name="x" className="h-3 w-3" /> Failed
      </span>
    );
  if (state.status === "paused")
    return (
      <span className="pill bg-amber-500/10 text-amber-200 ring-amber-500/30">
        <Icon name="alert" className="h-3 w-3" /> Paused
      </span>
    );
  if (state.status === "done") {
    const s = state.finalStatus || "";
    if (s === "approved")
      return (
        <span className="pill bg-emerald-500/10 text-emerald-300 ring-emerald-500/30">
          <Icon name="check" className="h-3 w-3" /> Approved
        </span>
      );
    if (s === "rejected")
      return (
        <span className="pill bg-rose-500/10 text-rose-300 ring-rose-500/30">
          <Icon name="x" className="h-3 w-3" /> Rejected
        </span>
      );
    return (
      <span className="pill bg-white/[0.04] text-zinc-300 ring-white/10">Done</span>
    );
  }
  return (
    <span className="pill bg-violet-500/10 text-violet-200 ring-violet-500/30">
      <span className="relative mr-1 flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-violet-400" />
      </span>
      Processing
    </span>
  );
}
