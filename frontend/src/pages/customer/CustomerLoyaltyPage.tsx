import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib';
import { useAuth } from '../../contexts/AuthContext';

type LoyaltyPayload = {
  loyalty: { loyalty_points: number; preferred_language?: string | null };
  recentOrders: Array<{ id: string; restaurant_name: string; total_amount: number | string; status: string }>;
};

export function CustomerLoyaltyPage() {
  const { token, user } = useAuth();
  const [data, setData] = useState<LoyaltyPayload | null>(null);

  useEffect(() => {
    if (!token) return;
    api<any>('/customer/home', {}, token)
      .then((payload) => setData({ loyalty: payload.loyalty, recentOrders: payload.recentOrders || [] }))
      .catch(console.error);
  }, [token]);

  const tier = useMemo(() => {
    const points = data?.loyalty?.loyalty_points ?? 0;
    if (points >= 1000) return 'Gold';
    if (points >= 500) return 'Silver';
    return 'Starter';
  }, [data]);

  const nextTierTarget = useMemo(() => {
    const points = data?.loyalty?.loyalty_points ?? 0;
    if (points >= 1000) return 1000;
    if (points >= 500) return 1000;
    return 500;
  }, [data]);

  const points = data?.loyalty?.loyalty_points ?? 0;
  const progress = Math.min(100, Math.round((points / nextTierTarget) * 100));

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <div className="eyebrow">Loyalty</div>
          <h1>Your rewards profile</h1>
          <p>Track points, see your current tier, and manage your customer profile.</p>
        </div>
        <div className="hero-actions">
          <Link className="secondary-btn inline-btn" to="/profile">View profile</Link>
          <Link className="primary-btn inline-btn" to="/customer/deals">Open deals</Link>
        </div>
      </div>

      <div className="mini-stat-row">
        <div className="mini-stat"><span>Current tier</span><strong>{tier}</strong></div>
        <div className="mini-stat"><span>Loyalty points</span><strong>{points}</strong></div>
        <div className="mini-stat"><span>Preferred language</span><strong>{data?.loyalty?.preferred_language || 'en'}</strong></div>
        <div className="mini-stat"><span>Recent orders</span><strong>{data?.recentOrders?.length ?? 0}</strong></div>
      </div>

      <section className="panel">
        <div className="panel-header"><h3>Progress to next reward tier</h3></div>
        <div className="progress-card">
          <div className="progress-card-top">
            <strong>{tier} member</strong>
            <span>{points} / {nextTierTarget} pts</span>
          </div>
          <div className="progress-track"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
          <p className="muted">Keep ordering from your favorite stores to unlock more rewards and offers.</p>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><h3>Account snapshot</h3></div>
        <div className="loyalty-profile-card">
          <div>
            <div className="muted">Customer</div>
            <strong>{user?.fullName}</strong>
          </div>
          <div>
            <div className="muted">Rewards status</div>
            <strong>{tier}</strong>
          </div>
          <div>
            <div className="muted">Points balance</div>
            <strong>{points}</strong>
          </div>
          <Link className="secondary-btn inline-btn" to="/profile">View profile</Link>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><h3>Recent orders linked to rewards</h3></div>
        <div className="simple-list">
          {(data?.recentOrders ?? []).map((order) => (
            <div className="simple-list-row" key={order.id}>
              <div>
                <strong>{order.restaurant_name}</strong>
                <div className="muted">Order #{order.id.slice(0, 8)}</div>
              </div>
              <span className="status-pill active">{order.status}</span>
            </div>
          ))}
          {!data?.recentOrders?.length ? <div className="muted">No orders yet. Start with Discover or Deals to begin earning points.</div> : null}
        </div>
      </section>
    </div>
  );
}
