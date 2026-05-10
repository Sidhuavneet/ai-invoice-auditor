"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/lib/ui";

const items = [
  { href: "/", label: "Dashboard", icon: "home" as const },
  { href: "/chat", label: "QA Chat", icon: "chat" as const },
];

export function SideNav() {
  const pathname = usePathname();
  return (
    <aside className="sticky top-6 hidden h-[calc(100vh-3rem)] w-60 shrink-0 flex-col gap-6 rounded-2xl border border-stone-200 bg-white/70 p-5 shadow-sm backdrop-blur-md md:flex">
      <Link href="/" className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm">
          <Icon name="sparkles" className="h-5 w-5" />
        </span>
        <span className="flex flex-col leading-tight">
          <span className="text-sm font-semibold tracking-tight">Invoice Auditor</span>
          <span className="text-[11px] text-stone-500">Multi-agent AI</span>
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
              className={`group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                active
                  ? "bg-stone-900 text-white shadow-sm"
                  : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
              }`}
            >
              <Icon name={it.icon} className="h-4 w-4" />
              {it.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto rounded-lg border border-stone-200 bg-gradient-to-br from-indigo-50 to-violet-50 p-3">
        <div className="flex items-center gap-1.5 text-xs font-medium text-indigo-900">
          <Icon name="sparkles" className="h-3.5 w-3.5" /> Powered by
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-indigo-800/80">
          LangGraph · Groq Llama 3.3 · FAISS · FastAPI
        </p>
      </div>
    </aside>
  );
}
