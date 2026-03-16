import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, formatDate } from '../../lib';
import { useAuth } from '../../contexts/AuthContext';
import { DataTable } from '../../components/DataTable';

type Inventory = { id: string; item_name: string; sku: string | null; stock_quantity: string; reorder_threshold: string; unit: string | null; is_active: boolean; last_counted_at: string | null };

export function RestaurantInventoryPage() {
  const { restaurantId = '' } = useParams();
  const { token } = useAuth();
  const [rows, setRows] = useState<Inventory[]>([]);

  useEffect(() => {
    if (!token) return;
    api<Inventory[]>(`/restaurants/${restaurantId}/inventory`, {}, token).then(setRows).catch(console.error);
  }, [token, restaurantId]);

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <div className="eyebrow">Restaurant workspace</div>
          <h1>Inventory</h1>
          <p>Watch stock levels and reorder thresholds.</p>
        </div>
      </div>
      <div className="panel">
        <DataTable
          headers={["Item", "SKU", "Stock", "Threshold", "Unit", "Last counted"]}
          rows={rows.map((row) => [
            <div><strong>{row.item_name}</strong><div className="muted">{Number(row.stock_quantity) <= Number(row.reorder_threshold) ? 'Low stock' : 'Healthy stock'}</div></div>,
            row.sku || '—',
            row.stock_quantity,
            row.reorder_threshold,
            row.unit || '—',
            formatDate(row.last_counted_at)
          ])}
        />
      </div>
    </div>
  );
}
