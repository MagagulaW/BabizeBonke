import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, currency } from '../../lib';
import { useAuth } from '../../contexts/AuthContext';
import { StatCard } from '../../components/StatCard';

type Data = {
  restaurant: { display_name: string; status: string; commission_rate: string; accepts_delivery: boolean; accepts_pickup: boolean };
  orders: { total: number; new_orders: number; preparing: number; delivered: number; sales: string | number };
  menu: { categories: number; active_items: number };
  inventory: { tracked_items: number; low_stock: number };
  trend: { status: string; total: number }[];
};

export function RestaurantDashboard() {
  const { restaurantId = '' } = useParams();
  const { token } = useAuth();
  const [data, setData] = useState<Data | null>(null);

  useEffect(() => {
    if (!token || !restaurantId) return;
    api<Data>(`/restaurants/${restaurantId}/dashboard`, {}, token).then(setData).catch(console.error);
  }, [token, restaurantId]);

  if (!data) return <div className="page-shell">Loading dashboard...</div>;

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <div className="eyebrow">Restaurant workspace</div>
          <h1>{data.restaurant.display_name}</h1>
          <p>Manage menu, orders, and stock from one dashboard.</p>
        </div>
      </div>

      <div className="stats-grid">
        <StatCard icon="🍽️" label="Active menu items" value={data.menu.active_items} hint={`${data.menu.categories} categories`} />
        <StatCard icon="🧾" label="Orders" value={data.orders.total} hint={`${data.orders.new_orders} new · ${data.orders.preparing} preparing`} />
        <StatCard icon="💸" label="Sales" value={currency(data.orders.sales)} hint={`${data.orders.delivered} delivered`} />
        <StatCard icon="📦" label="Inventory alerts" value={data.inventory.low_stock} hint={`${data.inventory.tracked_items} tracked items`} />
      </div>

      <div className="grid-two">
        <section className="panel">
          <div className="panel-header"><h3>Store settings</h3></div>
          <div className="mini-stat-row">
            <div className="mini-stat"><span>Status</span><strong>{data.restaurant.status}</strong></div>
            <div className="mini-stat"><span>Commission</span><strong>{data.restaurant.commission_rate}%</strong></div>
            <div className="mini-stat"><span>Delivery / Pickup</span><strong>{data.restaurant.accepts_delivery ? 'Yes' : 'No'} / {data.restaurant.accepts_pickup ? 'Yes' : 'No'}</strong></div>
          </div>
        </section>
        <section className="panel">
          <div className="panel-header"><h3>Order status mix</h3></div>
          <div className="activity-list">
            {data.trend.map((item) => (
              <div className="activity-item" key={item.status}>
                <div><strong>{item.status}</strong></div>
                <span>{item.total}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
