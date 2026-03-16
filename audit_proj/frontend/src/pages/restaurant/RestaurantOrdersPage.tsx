import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, currency, formatDate } from '../../lib';
import { useAuth } from '../../contexts/AuthContext';
import { DataTable } from '../../components/DataTable';

type Order = { id: string; status: string; order_type: string; total_amount: string; placed_at: string; customer_name: string };

export function RestaurantOrdersPage() {
  const { restaurantId = '' } = useParams();
  const { token } = useAuth();
  const [rows, setRows] = useState<Order[]>([]);
  const [reasonByOrder, setReasonByOrder] = useState<Record<string, string>>({});
  const [prepEtaByOrder, setPrepEtaByOrder] = useState<Record<string, string>>({});

  async function load() {
    if (!token) return;
    const result = await api<Order[]>(`/restaurants/${restaurantId}/orders`, {}, token);
    setRows(result);
  }

  useEffect(() => { void load(); }, [token, restaurantId]);

  async function mark(orderId: string, status: string) {
    if (!token) return;
    await api(`/restaurants/${restaurantId}/orders/${orderId}/status`, { method: 'PATCH', body: JSON.stringify({ status, reason: reasonByOrder[orderId] || null, estimatedPrepMins: prepEtaByOrder[orderId] ? Number(prepEtaByOrder[orderId]) : null }) }, token);
    await load();
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <div className="eyebrow">Restaurant workspace</div>
          <h1>Order board</h1>
          <p>Accept, reject, prepare, and alert customers automatically as kitchen activity changes.</p>
        </div>
      </div>
      <div className="panel">
        <DataTable
          headers={["Order", "Customer", "Type", "Status", "Total", "Placed", "Actions"]}
          rows={rows.map((row) => [
            row.id.slice(0, 8),
            row.customer_name,
            row.order_type,
            <span className={`status-pill ${row.status}`}>{row.status}</span>,
            currency(row.total_amount),
            formatDate(row.placed_at),
            <div className="actions" style={{ flexWrap: 'wrap' }}>
              <input className="text-input" style={{ minWidth: 120 }} placeholder="Prep ETA mins" type="number" min={0} value={prepEtaByOrder[row.id] ?? ''} onChange={(e) => setPrepEtaByOrder((prev) => ({ ...prev, [row.id]: e.target.value }))} />
              <input className="text-input" style={{ minWidth: 180 }} placeholder="Reject / delay reason" value={reasonByOrder[row.id] ?? ''} onChange={(e) => setReasonByOrder((prev) => ({ ...prev, [row.id]: e.target.value }))} />
              <button className="chip-btn" onClick={() => mark(row.id, 'confirmed')}>Accept</button>
              <button className="chip-btn" onClick={() => mark(row.id, 'preparing')}>Preparing</button>
              <button className="chip-btn" onClick={() => mark(row.id, 'ready_for_pickup')}>Ready</button>
              <button className="chip-btn" onClick={() => mark(row.id, 'cancelled')}>Reject</button>
            </div>
          ])}
        />
      </div>
    </div>
  );
}
