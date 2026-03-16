import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, currency, formatDate } from '../../lib';
import { useAuth } from '../../contexts/AuthContext';
import { StatCard } from '../../components/StatCard';

type Data = {
  restaurant: { display_name: string; status: string; commission_rate: string; accepts_delivery: boolean; accepts_pickup: boolean };
  orders: { total: number; new_orders: number; preparing: number; delivered: number; sales: string | number };
  menu: { categories: number; active_items: number };
  inventory: { tracked_items: number; low_stock: number };
  trend: { status: string; total: number }[];
};
type PayoutSummary = { restaurant?: { available_balance: string | number; app_commission_accrued: string | number; applied_commission_rate: string | number } };
type BankAccount = { id: string; account_name: string; bank_name: string; account_number_masked: string; is_primary: boolean };
type Payout = { id: string; amount: string | number; status: string; created_at: string; bank_name?: string | null; account_number_masked?: string | null };

export function RestaurantDashboard() {
  const { restaurantId = '' } = useParams();
  const { token } = useAuth();
  const [data, setData] = useState<Data | null>(null);
  const [summary, setSummary] = useState<PayoutSummary | null>(null);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [history, setHistory] = useState<Payout[]>([]);
  const [claimAmount, setClaimAmount] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [saving, setSaving] = useState(false);
  const [accountForm, setAccountForm] = useState({ accountName: '', bankName: '', accountNumber: '', branchCode: '', accountType: 'business' });

  async function load() {
    if (!token || !restaurantId) return;
    const [dashboard, payoutSummary, bankAccounts, payoutHistory] = await Promise.all([
      api<Data>(`/restaurants/${restaurantId}/dashboard`, {}, token),
      api<PayoutSummary>(`/payouts/summary?restaurantId=${restaurantId}`, {}, token),
      api<BankAccount[]>(`/payouts/bank-accounts?restaurantId=${restaurantId}`, {}, token),
      api<Payout[]>(`/payouts/history?partyType=restaurant&restaurantId=${restaurantId}`, {}, token)
    ]);
    setData(dashboard);
    setSummary(payoutSummary);
    setAccounts(bankAccounts);
    setHistory(payoutHistory);
    setSelectedAccountId(bankAccounts.find((item) => item.is_primary)?.id || bankAccounts[0]?.id || '');
  }

  useEffect(() => { void load(); }, [token, restaurantId]);

  const available = Number(summary?.restaurant?.available_balance || 0);
  const latestAccountId = useMemo(() => selectedAccountId || accounts.find((item) => item.is_primary)?.id || accounts[0]?.id || '', [selectedAccountId, accounts]);
  const canClaim = Number(claimAmount || 0) > 0 && Number(claimAmount) <= available && !!latestAccountId;

  async function addBankAccount() {
    if (!token || !restaurantId) return;
    setSaving(true);
    try {
      await api('/payouts/bank-accounts', { method: 'POST', body: JSON.stringify({ holderScope: 'restaurant', restaurantId, accountName: accountForm.accountName, bankName: accountForm.bankName, accountNumber: accountForm.accountNumber, branchCode: accountForm.branchCode || null, accountType: accountForm.accountType, isPrimary: true }) }, token);
      setAccountForm({ accountName: '', bankName: '', accountNumber: '', branchCode: '', accountType: 'business' });
      await load();
    } finally { setSaving(false); }
  }

  async function requestClaim() {
    if (!token || !restaurantId || !canClaim) return;
    setSaving(true);
    try {
      await api('/payouts/request', { method: 'POST', body: JSON.stringify({ partyType: 'restaurant', restaurantId, amount: Number(claimAmount), bankAccountId: latestAccountId || null, reference: 'Restaurant earnings claim' }) }, token);
      setClaimAmount('');
      await load();
      alert('Restaurant claim submitted for admin approval');
    } finally { setSaving(false); }
  }

  if (!data) return <div className="page-shell">Loading dashboard...</div>;

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <div className="eyebrow">Restaurant workspace</div>
          <h1>{data.restaurant.display_name}</h1>
          <p>Manage menu, orders, stock, and payout claims from one dashboard.</p>
        </div>
      </div>

      <div className="stats-grid">
        <StatCard icon="🍽️" label="Active menu items" value={data.menu.active_items} hint={`${data.menu.categories} categories`} />
        <StatCard icon="🧾" label="Orders" value={data.orders.total} hint={`${data.orders.new_orders} new · ${data.orders.preparing} preparing`} />
        <StatCard icon="💸" label="Sales" value={currency(data.orders.sales)} hint={`${data.orders.delivered} delivered`} />
        <StatCard icon="🏦" label="Claimable balance" value={currency(available)} hint={`Commission held by system: ${currency(summary?.restaurant?.app_commission_accrued || 0)}`} />
      </div>

      <div className="grid-two">
        <section className="panel">
          <div className="panel-header"><h3>Store settings</h3></div>
          <div className="mini-stat-row">
            <div className="mini-stat"><span>Status</span><strong>{data.restaurant.status}</strong></div>
            <div className="mini-stat"><span>Commission</span><strong>{summary?.restaurant?.applied_commission_rate || data.restaurant.commission_rate}%</strong></div>
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

      <div className="grid-two">
        <section className="panel">
          <div className="panel-header"><h3>Claim restaurant earnings</h3></div>
          <label>Claim amount</label>
          <input type="number" min="0" step="0.01" value={claimAmount} onChange={(e) => setClaimAmount(e.target.value)} placeholder="0.00" />
          <label>Payout account</label>
          <select value={latestAccountId} onChange={(e) => setSelectedAccountId(e.target.value)}>
            <option value="">Select bank account</option>
            {accounts.map((row) => <option key={row.id} value={row.id}>{row.bank_name} · {row.account_number_masked}</option>)}
          </select>
          <button className="primary-btn block" disabled={!canClaim || saving} onClick={() => void requestClaim()}>{saving ? 'Submitting…' : 'Claim earnings'}</button>
          <div className="muted">Only net restaurant earnings are claimable. System commission stays in the app account.</div>
        </section>
        <section className="panel">
          <div className="panel-header"><h3>Add restaurant payout account</h3></div>
          <label>Account name</label>
          <input value={accountForm.accountName} onChange={(e) => setAccountForm((s) => ({ ...s, accountName: e.target.value }))} />
          <label>Bank name</label>
          <input value={accountForm.bankName} onChange={(e) => setAccountForm((s) => ({ ...s, bankName: e.target.value }))} />
          <label>Account number</label>
          <input value={accountForm.accountNumber} onChange={(e) => setAccountForm((s) => ({ ...s, accountNumber: e.target.value }))} />
          <label>Branch code</label>
          <input value={accountForm.branchCode} onChange={(e) => setAccountForm((s) => ({ ...s, branchCode: e.target.value }))} />
          <button className="secondary-btn block" disabled={saving} onClick={() => void addBankAccount()}>{saving ? 'Saving…' : 'Save payout account'}</button>
        </section>
      </div>

      <section className="panel">
        <div className="panel-header"><h3>Claim history</h3></div>
        <div className="stack-list">
          {history.map((row) => <div className="stack-item" key={row.id}><div><strong>{currency(row.amount)}</strong><div className="muted">{row.bank_name || 'Bank'} · {row.account_number_masked || '—'}</div></div><div><span className={`status-pill ${row.status}`}>{row.status}</span><div className="muted">{formatDate(row.created_at)}</div></div></div>)}
        </div>
      </section>
    </div>
  );
}
