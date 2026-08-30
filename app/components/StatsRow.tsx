interface StatsRowProps {
  total: number;
  successful: number;
  failed: number;
  running: number;
}

function StatTile({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="flex-1 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
      <div className={`text-2xl font-semibold ${accent}`}>{value}</div>
      <div className="mt-1 text-xs uppercase tracking-wide text-neutral-500">{label}</div>
    </div>
  );
}

export function StatsRow({ total, successful, failed, running }: StatsRowProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatTile label="Total requests" value={total} accent="text-neutral-100" />
      <StatTile label="Successful" value={successful} accent="text-emerald-400" />
      <StatTile label="Failed" value={failed} accent="text-red-400" />
      <StatTile label="Running / pending" value={running} accent="text-sky-400" />
    </div>
  );
}
