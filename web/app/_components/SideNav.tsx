"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Icon } from "@/lib/ui";

const items = [
  { href: "/", label: "Dashboard", icon: "home" as const, featured: false },
  { href: "/chat", label: "QA Chat", icon: "chat" as const, featured: false },
  { href: "/tech", label: "Tech Page", icon: "sparkles" as const, featured: true },
];

// Compact label shown beneath the icon in the mobile top bar.
function shortLabel(label: string): string {
  if (label === "Dashboard") return "Home";
  if (label === "QA Chat") return "Chat";
  if (label === "Tech Page") return "Tech";
  return label;
}

export function SideNav() {
  const pathname = usePathname();
  return (
    <>
      <MobileTopNav pathname={pathname} />
      <DesktopSideNav pathname={pathname} />
    </>
  );
}

function MobileTopNav({ pathname }: { pathname: string }) {
  return (
    <header
      className="sticky top-0 z-40 -mx-4 mb-4 flex items-center justify-between gap-3 border-b border-[color:var(--border)] bg-[color:var(--bg-card)]/85 px-4 py-3 backdrop-blur-xl md:hidden"
      style={{ boxShadow: "0 8px 24px -16px rgba(0,0,0,0.6)" }}
    >
      <Link href="/" className="flex items-center gap-2">
        <span
          className="flex h-8 w-8 items-center justify-center rounded-lg text-white"
          style={{
            background: "linear-gradient(135deg, rgb(167,139,250) 0%, rgb(34,211,238) 100%)",
            boxShadow: "0 0 16px -4px rgb(167 139 250 / 0.6)",
          }}
        >
          <Icon name="sparkles" className="h-4 w-4" />
        </span>
        <span className="text-sm font-semibold tracking-tight">Invoice Auditor</span>
      </Link>
      <nav className="flex items-center gap-1">
        {items.map((it) => {
          const active =
            it.href === "/" ? pathname === "/" || pathname.startsWith("/invoices") : pathname.startsWith(it.href);
          return (
            <Link
              key={it.href}
              href={it.href}
              aria-label={it.label}
              title={it.label}
              className={`relative flex min-w-[3.25rem] flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-1.5 transition-all ${
                active
                  ? "text-white"
                  : it.featured
                    ? "text-violet-100"
                    : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100"
              }`}
              style={
                active
                  ? {
                      background:
                        "linear-gradient(135deg, rgb(167,139,250,0.18) 0%, rgb(34,211,238,0.10) 100%)",
                      boxShadow: "0 0 16px -8px rgb(167 139 250 / 0.5)",
                    }
                  : it.featured
                    ? {
                        background:
                          "linear-gradient(135deg, rgba(167,139,250,0.12) 0%, rgba(34,211,238,0.06) 100%)",
                        border: "1px solid rgba(167,139,250,0.20)",
                      }
                    : undefined
              }
            >
              <Icon name={it.icon} className="h-4 w-4" />
              <span className="text-[10px] font-medium leading-none">{shortLabel(it.label)}</span>
              {it.featured && !active && (
                <span className="absolute -right-0.5 -top-0.5 flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-violet-400" />
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}

function DesktopSideNav({ pathname }: { pathname: string }) {
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
                  : it.featured
                    ? "text-violet-100 hover:text-white"
                    : "text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-100"
              }`}
              style={
                it.featured && !active
                  ? {
                      background:
                        "linear-gradient(135deg, rgba(167,139,250,0.10) 0%, rgba(34,211,238,0.06) 100%)",
                      border: "1px solid rgba(167,139,250,0.20)",
                    }
                  : undefined
              }
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
              <span className="flex-1">{it.label}</span>
              {it.featured && !active && (
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-violet-400" />
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </motion.aside>
  );
}
