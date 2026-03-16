import type { ReactNode } from 'react';

export function StatCard({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: string; icon?: string }) {
  return (
    <div className="stat-card">
      <div className="stat-card-top">
        <span className="stat-icon">{icon || '◉'}</span>
        <span className="stat-label">{label}</span>
      </div>
      <div className="stat-value">{value}</div>
      {hint ? <div className="stat-hint">{hint}</div> : null}
    </div>
  );
}
