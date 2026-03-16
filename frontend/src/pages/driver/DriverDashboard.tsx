import { useEffect, useState } from 'react';
import { api, currency } from '../../lib';
import { useAuth } from '../../contexts/AuthContext';
import { StatCard } from '../../components/StatCard';

type Data = { profile: { onboarding_status: string; rating: string | number; total_deliveries: number; available_for_dispatch: boolean } | null; deliveries: { total: number; active: number; delivered: number }; earnings: { total_earnings: string | number }; latestLocation: { latitude: number; longitude: number } | null };

export function DriverDashboard() {
  const { token } = useAuth();
  const [data, setData] = useState<Data | null>(null);
  useEffect(() => { if (!token) return; api<Data>('/driver/dashboard', {}, token).then(setData).catch(console.error); }, [token]);
  if (!data) return <div className="page-shell">Loading driver dashboard...</div>;
  return <div className="page-shell"><div className="page-header"><div><div className="eyebrow"></div><h1>Delivery cockpit</h1><p>Accept work, update delivery status, and monitor earnings.</p></div></div><div className="stats-grid"><StatCard icon="🚚" label="Active deliveries" value={data.deliveries.active} hint={`${data.deliveries.total} total assigned/offered`} /><StatCard icon="✅" label="Completed" value={data.deliveries.delivered} hint="Lifetime completed deliveries" /><StatCard icon="💸" label="Earnings" value={currency(data.earnings.total_earnings)} hint="Delivered payout estimates" /><StatCard icon="⭐" label="Driver rating" value={data.profile?.rating ?? '—'} hint={data.profile?.available_for_dispatch ? 'Available for dispatch' : 'Currently busy'} /></div><div className="grid-two"><section className="panel"><div className="panel-header"><h3>Profile status</h3></div><div className="mini-stat-row"><div className="mini-stat"><span>Onboarding</span><strong>{data.profile?.onboarding_status ?? '—'}</strong></div><div className="mini-stat"><span>Total deliveries</span><strong>{data.profile?.total_deliveries ?? 0}</strong></div><div className="mini-stat"><span>Latest ping</span><strong>{data.latestLocation ? `${data.latestLocation.latitude.toFixed(3)}, ${data.latestLocation.longitude.toFixed(3)}` : 'No ping'}</strong></div></div></section></div></div>;
}
