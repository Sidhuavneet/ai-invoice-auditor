import { InvoiceSummary } from "./api";

export function Icon({
  name,
  className = "h-4 w-4",
}: {
  name:
    | "upload"
    | "play"
    | "file"
    | "check"
    | "x"
    | "alert"
    | "clock"
    | "search"
    | "send"
    | "sparkles"
    | "chart"
    | "chat"
    | "home"
    | "arrow-left"
    | "arrow-right"
    | "external"
    | "spinner"
    | "info"
    | "refresh";
  className?: string;
}) {
  const paths: Record<string, JSX.Element> = {
    upload: (
      <>
        <path d="M12 16V4" />
        <path d="m6 10 6-6 6 6" />
        <path d="M4 20h16" />
      </>
    ),
    play: <path d="M6 4l14 8-14 8V4z" />,
    file: (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
      </>
    ),
    check: <path d="M5 12l5 5L20 7" />,
    x: (
      <>
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
      </>
    ),
    alert: (
      <>
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" />
      </>
    ),
    send: <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" />,
    sparkles: (
      <>
        <path d="M9.94 14.06 8 20l-1.94-5.94L0 12l6.06-2.06L8 4l1.94 5.94L16 12z" />
        <path d="M18 4v4M16 6h4" />
      </>
    ),
    chart: (
      <>
        <path d="M3 3v18h18" />
        <path d="M7 14l4-4 4 4 5-6" />
      </>
    ),
    chat: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
    home: (
      <>
        <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2h-4v-6h-6v6H5a2 2 0 0 1-2-2z" />
      </>
    ),
    "arrow-left": (
      <>
        <path d="m12 19-7-7 7-7" />
        <path d="M19 12H5" />
      </>
    ),
    "arrow-right": (
      <>
        <path d="M5 12h14" />
        <path d="m12 5 7 7-7 7" />
      </>
    ),
    external: (
      <>
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        <path d="M15 3h6v6" />
        <path d="M10 14 21 3" />
      </>
    ),
    spinner: (
      <>
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </>
    ),
    info: (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4M12 8h.01" />
      </>
    ),
    refresh: (
      <>
        <path d="M3 12a9 9 0 0 1 15.36-6.36L21 8" />
        <path d="M21 3v5h-5" />
        <path d="M21 12a9 9 0 0 1-15.36 6.36L3 16" />
        <path d="M3 21v-5h5" />
      </>
    ),
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return <Icon name="spinner" className={`${className} animate-spin`} />;
}

export type StatusKind = "approved" | "rejected" | "review" | "pending" | "neutral";

export function classifyStatus(s: InvoiceSummary): StatusKind {
  // Backend now emits canonical snake_case lowercase values, but we keep
  // tolerance for legacy reports written before normalization.
  const norm = (v: any) =>
    (v || "").toString().toLowerCase().trim().replace(/\s+/g, "_");
  const rec = norm(s.recommendation);
  const st = norm(s.status);
  if (st === "approved" || st === "accept" || rec === "approve" || rec === "approved" || rec === "accept")
    return "approved";
  if (st === "rejected" || st === "reject" || rec === "reject" || rec === "rejected")
    return "rejected";
  if (st === "manual_review" || rec === "manual_review") return "review";
  if (st === "pending" || (!st && !rec)) return "pending";
  return "neutral";
}

export function StatusPill({ kind, label }: { kind: StatusKind; label?: string }) {
  const config: Record<StatusKind, { cls: string; icon: any; text: string }> = {
    approved: {
      cls: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30",
      icon: "check",
      text: "Approved",
    },
    rejected: {
      cls: "bg-rose-500/10 text-rose-300 ring-rose-500/30",
      icon: "x",
      text: "Rejected",
    },
    review: {
      cls: "bg-amber-500/10 text-amber-200 ring-amber-500/30",
      icon: "alert",
      text: "Needs Review",
    },
    pending: {
      cls: "bg-white/[0.04] text-zinc-400 ring-white/10",
      icon: "clock",
      text: "Pending",
    },
    neutral: {
      cls: "bg-white/[0.04] text-zinc-300 ring-white/10",
      icon: "info",
      text: "—",
    },
  };
  const c = config[kind];
  return (
    <span className={`pill ${c.cls}`}>
      <Icon name={c.icon} className="h-3 w-3" />
      {label || c.text}
    </span>
  );
}

export function Toast({
  kind,
  children,
  onClose,
}: {
  kind: "info" | "error" | "success";
  children: React.ReactNode;
  onClose?: () => void;
}) {
  const palette = {
    info: "bg-violet-500/10 text-violet-200 ring-violet-500/30",
    error: "bg-rose-500/10 text-rose-200 ring-rose-500/30",
    success: "bg-emerald-500/10 text-emerald-200 ring-emerald-500/30",
  }[kind];
  const iconName = kind === "error" ? "alert" : kind === "success" ? "check" : "info";
  return (
    <div
      className={`animate-in flex items-start gap-2 rounded-lg px-3 py-2 text-sm ring-1 ring-inset ${palette}`}
    >
      <Icon name={iconName} className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1 whitespace-pre-wrap">{children}</div>
      {onClose && (
        <button
          onClick={onClose}
          className="opacity-60 hover:opacity-100"
          aria-label="dismiss"
        >
          <Icon name="x" className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

const SYMBOL_TO_ISO: Record<string, string> = {
  "€": "EUR",
  "$": "USD",
  "£": "GBP",
  "¥": "JPY",
  "₹": "INR",
  "₩": "KRW",
  "₽": "RUB",
  "C$": "CAD",
  "A$": "AUD",
};

export function formatCurrency(amount: any, currency?: string): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  const raw = String(amount);
  const n = typeof amount === "number" ? amount : parseFloat(raw.replace(/[^0-9.\-]/g, ""));
  if (Number.isNaN(n)) return raw;

  // Resolve ISO currency from explicit field, embedded symbol, or amount string.
  let iso = (currency || "").trim().toUpperCase();
  if (iso.length !== 3) {
    const sym = (currency || raw).match(/[€$£¥₹₩₽]/)?.[0];
    if (sym && SYMBOL_TO_ISO[sym]) iso = SYMBOL_TO_ISO[sym];
  }
  if (iso.length !== 3) iso = "USD";

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: iso,
    }).format(n);
  } catch {
    return `${iso} ${n.toFixed(2)}`;
  }
}
