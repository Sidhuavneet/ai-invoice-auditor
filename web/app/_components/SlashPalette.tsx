"use client";

import { Command } from "cmdk";
import { motion } from "framer-motion";
import { useEffect } from "react";
import { Icon } from "@/lib/ui";

export type SlashItem = {
  id: string;
  label: string;
  hint: string;
  prompt: string;
  icon: any;
  needsArg?: boolean;       // true → user must finish typing before send
  argPlaceholder?: string;  // shown as ghost hint after the prefix
};

const ITEMS: SlashItem[] = [
  {
    id: "flagged",
    label: "/flagged",
    hint: "List invoices needing review",
    prompt: "Show all flagged invoices that need manual review.",
    icon: "alert",
  },
  {
    id: "overview",
    label: "/overview",
    hint: "Dashboard summary",
    prompt: "Give me an overall summary of all invoices and spend.",
    icon: "chart",
  },
  {
    id: "vendor",
    label: "/vendor",
    hint: "Stats for one vendor — type a name",
    prompt: "Show me everything about vendor ",
    icon: "file",
    needsArg: true,
    argPlaceholder: "vendor name",
  },
  {
    id: "anomalies",
    label: "/anomalies",
    hint: "Unusual invoices",
    prompt: "Which invoices are unusual or anomalous?",
    icon: "alert",
  },
  {
    id: "top-vendors",
    label: "/top-vendors",
    hint: "Vendors by spend",
    prompt: "Who are my top vendors by total spend?",
    icon: "chart",
  },
  {
    id: "recent",
    label: "/recent",
    hint: "Last 5 invoices",
    prompt: "Show me the 5 most recent invoices.",
    icon: "clock",
  },
  {
    id: "search",
    label: "/search",
    hint: "Semantic search — type a phrase",
    prompt: "Search invoices for ",
    icon: "search",
    needsArg: true,
    argPlaceholder: "what to search",
  },
  {
    id: "help",
    label: "/help",
    hint: "What can you do?",
    prompt: "What questions can I ask you about invoices?",
    icon: "info",
  },
];

/** Detect whether the current input is a slash-command prefix waiting for an
 * argument the user hasn't typed yet. Used to disable Send and show a hint. */
export function pendingSlashArg(input: string): SlashItem | null {
  const trimmed = input.trimEnd();
  for (const it of ITEMS) {
    if (!it.needsArg) continue;
    const prefix = it.prompt.trimEnd();
    if (trimmed === prefix) return it;
  }
  return null;
}

export function SlashPalette({
  query,
  onPick,
  onClose,
}: {
  query: string;
  onPick: (item: SlashItem) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.15 }}
      className="absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-xl border border-[color:var(--border)] shadow-2xl"
      style={{
        // Fully opaque + heavy backdrop blur so the chat scrolling behind it
        // doesn't bleed through. Sits above everything with strong shadow.
        background: "#0a0a10",
        backdropFilter: "blur(24px)",
        boxShadow:
          "0 0 0 1px rgba(167,139,250,0.25), 0 25px 60px -15px rgba(0,0,0,0.85), 0 0 40px -12px rgba(0,0,0,0.6)",
      }}
    >
      <Command label="Slash commands">
        <div className="border-b border-[color:var(--border)] px-3 py-2 text-[11px] uppercase tracking-wider text-zinc-500">
          Slash commands
        </div>
        <Command.List className="max-h-[280px] overflow-y-auto p-1">
          <Command.Empty className="px-3 py-4 text-center text-sm text-zinc-500">
            No command matches.
          </Command.Empty>
          {ITEMS.map((item) => {
            const value = item.label.slice(1);
            if (query && !value.includes(query.replace(/^\//, "").toLowerCase()))
              return null;
            return (
              <Command.Item
                key={item.id}
                value={value}
                onSelect={() => onPick(item)}
                className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-zinc-200 transition-colors aria-selected:bg-white/[0.06] aria-selected:text-zinc-100"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-violet-500/15 text-violet-300">
                  <Icon name={item.icon} className="h-3.5 w-3.5" />
                </span>
                <span className="flex-1">
                  <span className="font-mono text-violet-300">{item.label}</span>
                  <span className="ml-2 text-zinc-500">{item.hint}</span>
                </span>
                <Icon name="arrow-right" className="h-3 w-3 text-zinc-600" />
              </Command.Item>
            );
          })}
        </Command.List>
      </Command>
    </motion.div>
  );
}
