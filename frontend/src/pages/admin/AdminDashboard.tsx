import { useEffect, useState } from 'react';
import { api, currency, formatDate } from '../../lib';
import { useAuth } from '../../contexts/AuthContext';
import { StatCard } from '../../components/StatCard';

type DashboardData = {
  restaurants: { total: number; approved: number; pending: number };
  users: { total: number };
  orders: { total: number; placed: number; preparing: number; delivered: number };
  revenue: { gross_revenue: string | number };
  inventory: { low_stock: number };
  activity: { event: string; subject: string; happened_at: string }[];
};

export function AdminDashboard() {
  const { token } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    if (!token) return;
    api<DashboardData>('/admin/dashboard', {}, token).then(setData).catch(console.error);
  }, [token]);

  if (!data) return <div className="page-shell">Loading dashboard...</div>;

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <div className="eyebrow">Admin console</div>
          <h1>Platform overview</h1>
          <p>Live KPIs for restaurants, users, orders, revenue and inventory alerts.</p>
        </div>
      </div>

      <div className="stats-grid">
        <StatCard icon="🏪" label="Restaurants" value={data.restaurants.total} hint={`${data.restaurants.approved} approved · ${data.restaurants.pending} pending`} />
        <StatCard icon="👥" label="Users" value={data.users.total} hint="All users in the platform" />
        <StatCard icon="🧾" label="Orders" value={data.orders.total} hint={`${data.orders.placed} placed · ${data.orders.preparing} preparing`} />
        <StatCard icon="💰" label="Revenue" value={currency(data.revenue.gross_revenue)} hint={`${data.orders.delivered} delivered orders`} />
      </div>

      <div className="grid-two">
        <section className="panel">
          <div className="panel-header">
            <h3>Operations pulse</h3>
          </div>
          <div className="mini-stat-row">
            <div className="mini-stat"><span>Pending restaurant approvals</span><strong>{data.restaurants.pending}</strong></div>
            <div className="mini-stat"><span>Low stock alerts</span><strong>{data.inventory.low_stock}</strong></div>
            <div className="mini-stat"><span>Orders being prepared</span><strong>{data.orders.preparing}</strong></div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h3>Recent activity</h3>
          </div>
          <div className="activity-list">
            {data.activity.map((item, index) => (
              <div className="activity-item" key={`${item.subject}-${index}`}>
                <div>
                  <strong>{item.event}</strong>
                  <div>{item.subject}</div>
                </div>
                <span>{formatDate(item.happened_at)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
