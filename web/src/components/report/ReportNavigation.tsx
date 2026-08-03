import { STAT_DEFINITIONS } from "@/components/ui/definition-term";

export type ReportNavigationItem = {
  value: string;
  label: string;
  active: boolean;
  onSelect: () => void;
};

export function ReportPrimaryNavigation({ items }: { items: readonly ReportNavigationItem[] }) {
  return (
    <nav
      aria-label="Sections du rapport"
      className="report-primary-nav sticky top-0 z-20 mt-4 flex overflow-x-auto rounded-lg border border-white/[0.075] bg-[#111413]/95 p-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.18)] backdrop-blur-xl"
    >
      {items.map(({ value, label, active, onSelect }) => (
        <button
          key={value}
          type="button"
          aria-label={label}
          aria-current={active ? "page" : undefined}
          onClick={onSelect}
          className={[
            "relative flex h-10 shrink-0 items-center rounded-md px-4 text-[13px] font-semibold transition-all",
            active
              ? "bg-white/[0.085] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04),0_4px_14px_rgba(0,0,0,0.15)] after:absolute after:inset-x-4 after:bottom-0 after:h-px after:bg-emerald-300"
              : "text-neutral-500 enabled:hover:bg-white/[0.03] enabled:hover:text-neutral-200 disabled:cursor-not-allowed disabled:opacity-30",
          ].join(" ")}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}

export function ReportSecondaryNavigation({ items }: { items: readonly ReportNavigationItem[] }) {
  return (
    <nav
      aria-label="Analyses des joueurs"
      className="report-secondary-nav mt-3 flex overflow-x-auto border-b border-white/[0.075] px-1"
    >
      {items.map(({ value, label, active, onSelect }) => (
        <button
          key={value}
          type="button"
          aria-label={label}
          title={STAT_DEFINITIONS[label]}
          aria-current={active ? "page" : undefined}
          onClick={onSelect}
          className={[
            "relative h-11 shrink-0 px-3.5 text-xs font-semibold transition-colors",
            active
              ? "text-neutral-100 after:absolute after:inset-x-3.5 after:bottom-0 after:h-0.5 after:rounded-full after:bg-emerald-300"
              : "text-neutral-500 hover:text-neutral-200",
          ].join(" ")}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}
