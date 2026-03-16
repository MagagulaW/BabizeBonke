import { useEffect, useState } from 'react';
import { api, formatDate, resolveAssetUrl } from '../../lib';
import { useAuth } from '../../contexts/AuthContext';
import { DataTable } from '../../components/DataTable';

type Restaurant = {
  id: string; display_name: string; legal_name: string; status: string; support_email: string; support_phone: string;
  commission_rate: string; is_active: boolean; created_at: string; city: string; province: string; menu_items: number; orders: number; logo_url?: string | null; banner_url?: string | null;
};

export function AdminRestaurantsPage() {
  const { token } = useAuth();
  const [rows, setRows] = useState<Restaurant[]>([]);

  async function load() {
    if (!token) return;
    const result = await api<Restaurant[]>('/admin/restaurants', {}, token);
    setRows(result);
  }

  useEffect(() => { void load(); }, [token]);

  async function updateStatus(id: string, status: string) {
    if (!token) return;
    await api(`/admin/restaurants/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }, token);
    await load();
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <div className="eyebrow"></div>
          <h1>Restaurants</h1>
          <p>Approve, suspend, or review restaurant operations from one place.</p>
        </div>
      </div>
      <div className="panel">
        <DataTable
          headers={["Display name", "Location", "Status", "Commission", "Menu", "Orders", "Created", "Actions"]}
          rows={rows.map((row) => [
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}><div className="restaurant-logo">{row.logo_url ? <img src={resolveAssetUrl(row.logo_url)} alt={row.display_name} /> : '🍽️'}</div><div><strong>{row.display_name}</strong><div className="muted">{row.support_email || row.legal_name}</div>{row.banner_url ? <div className="muted">Banner uploaded</div> : null}</div></div>,
            `${row.city || '—'}, ${row.province || ''}`,
            <span className={`status-pill ${row.status}`}>{row.status}</span>,
            `${row.commission_rate}%`,
            row.menu_items,
            row.orders,
            formatDate(row.created_at),
            <div className="actions">
              <button className="chip-btn" onClick={() => updateStatus(row.id, 'approved')}>Approve</button>
              <button className="chip-btn warning" onClick={() => updateStatus(row.id, 'suspended')}>Suspend</button>
            </div>
          ])}
        />
      </div>
    </div>
  );
}
