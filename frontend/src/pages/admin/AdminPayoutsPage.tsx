import { useEffect, useState } from 'react';
import { api, currency, formatDate } from '../../lib';
import { useAuth } from '../../contexts/AuthContext';

type Claim = { id: string; party_type: 'driver' | 'restaurant'; amount: string | number; status: string; created_at: string; paid_at?: string | null; reference?: string | null; driver_name?: string | null; driver_email?: string | null; restaurant_name?: string | null; account_name?: string | null; bank_name?: string | null; account_number_masked?: string | null; approved_by_name?: string | null };
type Totals = { gross_collected: string | number; system_commission_retained: string | number; driver_earned_total: string | number; restaurant_earned_total: string | number; pending_claims_total: string | number; paid_claims_total: string | number };
type BalancesRow = { id: string; full_name?: string; email?: string; display_name?: string; support_email?: string; total_earned: string | number; total_claimed: string | number; pending_claims: string | number; available_balance: string | number };

export function AdminPayoutsPage() {
  const { token } = useAuth();
  const [claims, setClaims] = useState<Claim[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [balances, setBalances] = useState<{ drivers: BalancesRow[]; restaurants: BalancesRow[] }>({ drivers: [], restaurants: [] });
  const [error, setError] = useState('');

  async function load() {
    if (!token) return;
    try {
      setError('');
      const [claimsData, balanceData] = await Promise.all([
        api<{ totals: Totals; claims: Claim[] }>('/admin/payouts', {}, token),
        api<{ drivers: BalancesRow[]; restaurants: BalancesRow[] }>('/admin/payout-balances', {}, token)
      ]);
      setClaims(claimsData.claims);
      setTotals(claimsData.totals);
      setBalances(balanceData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load payout admin');
    }
  }

  useEffect(() => { void load(); }, [token]);

  async function updateStatus(id: string, status: string) {
    if (!token) return;
    await api(`/admin/payouts/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }, token);
    await load();
  }

  return <div className="page-shell">
    <div className="page-header"><div><div className="eyebrow">Finance admin</div><h1>Payout claims & balances</h1><p>Review what each driver and restaurant has earned, approve claims, and retain the 10%–15% system commission.</p></div></div>
    {error ? <div className="error-box">{error}</div> : null}
    {totals ? <div className="stats-grid">
      <section className="panel"><strong>System gross collected</strong><div>{currency(totals.gross_collected)}</div></section>
      <section className="panel"><strong>System commission retained</strong><div>{currency(totals.system_commission_retained)}</div></section>
      <section className="panel"><strong>Pending claims</strong><div>{currency(totals.pending_claims_total)}</div></section>
      <section className="panel"><strong>Paid claims</strong><div>{currency(totals.paid_claims_total)}</div></section>
    </div> : null}
    <div className="grid-two">
      <section className="panel"><div className="panel-header"><h3>Driver balances</h3></div><div className="stack-list">{balances.drivers.map((row) => <div className="stack-item" key={row.id}><div><strong>{row.full_name}</strong><div className="muted">{row.email}</div></div><div><div className="muted">Earned {currency(row.total_earned)}</div><div className="muted">Pending {currency(row.pending_claims)}</div><strong>{currency(row.available_balance)} available</strong></div></div>)}</div></section>
      <section className="panel"><div className="panel-header"><h3>Restaurant balances</h3></div><div className="stack-list">{balances.restaurants.map((row) => <div className="stack-item" key={row.id}><div><strong>{row.display_name}</strong><div className="muted">{row.support_email}</div></div><div><div className="muted">Earned {currency(row.total_earned)}</div><div className="muted">Pending {currency(row.pending_claims)}</div><strong>{currency(row.available_balance)} available</strong></div></div>)}</div></section>
    </div>
    <section className="panel"><div className="panel-header"><h3>Claim requests</h3></div><div className="stack-list">{claims.map((claim) => <div className="stack-item" key={claim.id}><div><strong>{claim.party_type === 'driver' ? claim.driver_name : claim.restaurant_name}</strong><div className="muted">{claim.party_type} · Requested {formatDate(claim.created_at)} · {claim.reference || 'No reference'}</div><div className="muted">{claim.bank_name || 'No bank'} · {claim.account_number_masked || 'No account'}</div><div className="muted">Approved by: {claim.approved_by_name || '—'}</div></div><div><span className={`status-pill ${claim.status}`}>{claim.status}</span><div><strong>{currency(claim.amount)}</strong></div><div className="actions">{claim.status === 'pending' ? <><button className="chip-btn" onClick={() => void updateStatus(claim.id, 'approved')}>Approve</button><button className="chip-btn warning" onClick={() => void updateStatus(claim.id, 'failed')}>Reject</button></> : null}{claim.status === 'approved' ? <button className="chip-btn" onClick={() => void updateStatus(claim.id, 'paid')}>Mark paid</button> : null}</div></div></div>)}</div></section>
  </div>;
}
