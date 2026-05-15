"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Icon } from "@/lib/ui";

const items = [
  { href: "/", label: "Dashboard", icon: "home" as const },
  { href: "/chat", label: "QA Chat", icon: "chat" as const },
];

export function SideNav() {
  const pathname = usePathname();
  return (
    <motion.aside
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
      className="sticky top-6 hidden h-[calc(100vh-3rem)] w-60 shrink-0 flex-col gap-6 rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-card)]/70 p-5 backdrop-blur-xl md:flex"
      style={{ boxShadow: "0 1px 0 0 rgba(255,255,255,0.03) inset, 0 20px 60px -20px rgba(0,0,0,0.6)" }}
    >
      <Link href="/" className="group flex items-center gap-2.5">
        <span
          className="relative flex h-9 w-9 items-center justify-center rounded-lg text-white"
          style={{
            background: "linear-gradient(135deg, rgb(167,139,250) 0%, rgb(34,211,238) 100%)",
            boxShadow: "0 0 24px -4px rgb(167 139 250 / 0.6)",
          }}
        >
          <Icon name="sparkles" className="h-5 w-5" />
        </span>
        <span className="flex flex-col leading-tight">
          <span className="text-sm font-semibold tracking-tight">Invoice Auditor</span>
          <span className="text-[11px] text-zinc-500">Multi-agent AI</span>
        </span>
      </Link>

      <nav className="flex flex-col gap-1">
        {items.map((it) => {
          const active =
            it.href === "/" ? pathname === "/" || pathname.startsWith("/invoices") : pathname.startsWith(it.href);
          return (
            <Link
              key={it.href}
              href={it.href}
              className={`group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                active
                  ? "bg-white/[0.06] text-white"
                  : "text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-100"
              }`}
            >
              {active && (
                <motion.span
                  layoutId="nav-active"
                  className="absolute inset-0 -z-10 rounded-lg"
                  style={{
                    background: "linear-gradient(135deg, rgb(167,139,250,0.15) 0%, rgb(34,211,238,0.08) 100%)",
                    boxShadow: "0 0 20px -8px rgb(167 139 250 / 0.5)",
                  }}
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
              <Icon name={it.icon} className="h-4 w-4" />
              {it.label}
            </Link>
          );
        })}
      </nav>

      <div
        className="mt-auto rounded-lg border border-[color:var(--border)] p-3"
        style={{
          background:
            "linear-gradient(135deg, rgba(167,139,250,0.08) 0%, rgba(34,211,238,0.04) 100%)",
        }}
      >
        <div className="flex items-center gap-1.5 text-xs font-medium text-violet-200">
          <Icon name="sparkles" className="h-3.5 w-3.5" /> Powered by
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
          LangGraph · Groq Llama 3.3 · ChromaDB · LangSmith
        </p>
      </div>
    </motion.aside>
  );
}
