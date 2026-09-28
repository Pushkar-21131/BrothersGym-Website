import { AlertTriangle, Info } from "lucide-react";

/**
 * Shared building blocks for the four legal/contact pages (terms, privacy,
 * refund, contact).
 *
 * These used to be re-declared inside each page — three near-identical `Section`
 * functions whose arbitrary-variant strings had drifted apart, which is why the
 * same list rendered with different spacing on different pages. One definition
 * here keeps them identical, and gives every section a stable `id` so the
 * layout's "On this page" rail has something to link to.
 */

/**
 * Body typography for a section. Kept as one string so paragraphs, nested lists
 * and list markers stay consistent across all four documents.
 *
 * No `[&_strong]` rule on purpose: emphasis colour is set per-element in the
 * page content (`text-white` for a term, `text-red-400` for the non-refundable
 * warnings). An arbitrary variant here would out-specify those classes and
 * flatten every warning to the same grey.
 */
const BODY =
  "text-[15px] leading-7 text-zinc-300 space-y-3 " +
  "[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-2 [&_ul]:text-zinc-400 [&_ul_li]:leading-relaxed " +
  "[&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-2 [&_ol]:text-zinc-400 " +
  "[&_ul_ul]:mt-2 [&_ul_ul]:pl-5 [&_ul_ul]:text-zinc-400";

export function LegalSection({
  id,
  icon,
  title,
  children,
}: {
  /** Anchor target — must match the id in the page's `sections` list. */
  id: string;
  icon?: React.ReactNode;
  /** Rendered as-is, including any leading "1. " numbering. */
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="not-prose scroll-mt-24 mb-9 md:mb-10">
      <h2 className="mb-3.5 flex items-center gap-2.5 text-lg font-black text-white md:text-xl">
        <span aria-hidden className="h-4 w-1 shrink-0 rounded-full bg-yellow-500" />
        {icon && <span className="shrink-0 text-yellow-500">{icon}</span>}
        <span>{title}</span>
      </h2>
      <div className={BODY}>{children}</div>
    </section>
  );
}

/** A titled group inside a section, e.g. "Personal Information". */
export function LegalSubSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4">
      <h3 className="mb-1.5 text-sm font-black uppercase tracking-wider text-yellow-500">
        {title}
      </h3>
      {children}
    </div>
  );
}

const CALLOUTS = {
  /** Irreversible consequence — the non-refundable rules. */
  danger: {
    box: "border-red-500/30 border-l-red-500 bg-red-500/[0.05]",
    icon: <AlertTriangle size={17} className="text-red-400" />,
    label: "text-red-300",
  },
  /** Standard emphasis — "your privacy matters", discretionary notes. */
  note: {
    box: "border-yellow-500/30 border-l-yellow-500 bg-yellow-500/[0.05]",
    icon: <Info size={17} className="text-yellow-500" />,
    label: "text-yellow-400",
  },
  neutral: {
    box: "border-zinc-800 border-l-zinc-600 bg-zinc-900/60",
    icon: <Info size={17} className="text-zinc-400" />,
    label: "text-white",
  },
} as const;

/**
 * The boxed asides that open a document or sit inside a section. A left accent
 * bar rather than a full tinted panel: it survives being nested inside another
 * card and doesn't compete with the section headings for attention.
 */
export function LegalCallout({
  variant = "note",
  title,
  icon,
  children,
}: {
  variant?: keyof typeof CALLOUTS;
  title?: string;
  /** Overrides the variant's default icon. */
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  const c = CALLOUTS[variant];
  return (
    <div className={`not-prose mb-6 rounded-r-xl border border-l-2 px-4 py-3.5 md:px-5 md:py-4 ${c.box}`}>
      <div className="flex gap-3">
        <span className="mt-0.5 shrink-0">{icon ?? c.icon}</span>
        <div className="min-w-0 flex-1 space-y-1.5">
          {title && <p className={`text-sm font-bold ${c.label}`}>{title}</p>}
          <div className="text-sm leading-relaxed text-zinc-400 [&_a]:text-yellow-500 [&_a]:underline [&_a]:underline-offset-2">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
