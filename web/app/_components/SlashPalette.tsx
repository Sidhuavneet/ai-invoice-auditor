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
    hint: "Stats for one vendor",
    prompt: "Show me everything about vendor ",
    icon: "file",
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
    hint: "Semantic invoice search",
    prompt: "Search invoices for ",
    icon: "search",
  },
  {
    id: "help",
    label: "/help",
    hint: "What can you do?",
    prompt: "What questions can I ask you about invoices?",
    icon: "info",
  },
];

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
      className="absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-card)]/95 shadow-2xl backdrop-blur-xl"
      style={{
        boxShadow:
          "0 0 0 1px rgba(167,139,250,0.2), 0 20px 50px -12px rgba(0,0,0,0.7)",
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
