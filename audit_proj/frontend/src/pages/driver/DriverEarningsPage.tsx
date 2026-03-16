import { useEffect, useState } from 'react';
import { api, currency, formatDate } from '../../lib';
import { useAuth } from '../../contexts/AuthContext';
import { DataTable } from '../../components/DataTable';

type Row = { id: string; order_id: string; restaurant_name: string; driver_payout_estimate: string | number; status: string; delivered_at: string };

export function DriverEarningsPage() {
  const { token } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => { if (!token) return; api<Row[]>('/driver/earnings', {}, token).then(setRows).catch(console.error); }, [token]);
  return <div className="page-shell"><div className="page-header"><div><div className="eyebrow"></div><h1>Earnings ledger</h1><p>Track payout estimates by delivery.</p></div></div><section className="panel"><DataTable headers={['Restaurant','Order','Status','Payout','Delivered']} rows={rows.map((row) => [row.restaurant_name, row.order_id.slice(0,8), row.status, currency(row.driver_payout_estimate), formatDate(row.delivered_at)])} /></section></div>;
}
