const STYLES: Record<string, string> = {
  success: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  failed: "bg-red-500/15 text-red-400 border-red-500/30",
  partial_failure: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  received: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  interpreting: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  executing: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  proposed: "bg-neutral-500/15 text-neutral-300 border-neutral-500/30",
  pending_approval: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  validated: "bg-neutral-500/15 text-neutral-300 border-neutral-500/30",
  active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  disabled: "bg-neutral-500/15 text-neutral-400 border-neutral-500/30",
  error: "bg-red-500/15 text-red-400 border-red-500/30",
};

export function StatusBadge({ status }: { status: string }) {
  const style = STYLES[status] ?? "bg-neutral-500/15 text-neutral-300 border-neutral-500/30";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${style}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}
