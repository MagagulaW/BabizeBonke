import { useEffect, useState } from 'react';
import { api, currency, formatDate } from '../../lib';
import { useAuth } from '../../contexts/AuthContext';
import { DataTable } from '../../components/DataTable';

type OrderRow = { id: string; status: string; order_type: string; total_amount: string; currency: string; placed_at: string; customer_name: string; restaurant_name: string };

export function AdminOrdersPage() {
  const { token } = useAuth();
  const [rows, setRows] = useState<OrderRow[]>([]);

  useEffect(() => {
    if (!token) return;
    api<OrderRow[]>('/admin/orders', {}, token).then(setRows).catch(console.error);
  }, [token]);

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <div className="eyebrow">Admin console</div>
          <h1>Orders monitor</h1>
          <p>Track order flow across the platform.</p>
        </div>
      </div>
      <div className="panel">
        <DataTable
          headers={["Order", "Restaurant", "Customer", "Type", "Status", "Total", "Placed"]}
          rows={rows.map((row) => [
            row.id.slice(0, 8),
            row.restaurant_name,
            row.customer_name,
            row.order_type,
            <span className={`status-pill ${row.status}`}>{row.status}</span>,
            currency(row.total_amount),
            formatDate(row.placed_at)
          ])}
        />
      </div>
    </div>
  );
}
