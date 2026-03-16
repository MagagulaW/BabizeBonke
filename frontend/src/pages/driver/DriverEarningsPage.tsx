import { useEffect, useMemo, useState } from 'react';
import { api, currency, formatDate } from '../../lib';
import { useAuth } from '../../contexts/AuthContext';
import { DataTable } from '../../components/DataTable';

type Row = { id: string; order_id: string; restaurant_name: string; driver_payout_estimate: string | number; status: string; delivered_at: string };
type Summary = { driver?: { available_balance: string | number; gross_earnings: string | number } };
type BankAccount = { id: string; account_name: string; bank_name: string; account_number_masked: string; is_primary: boolean };
type Payout = { id: string; amount: string | number; status: string; created_at: string; paid_at?: string | null; account_name?: string | null; bank_name?: string | null; account_number_masked?: string | null };

export function DriverEarningsPage() {
  const { token } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [history, setHistory] = useState<Payout[]>([]);
  const [claimAmount, setClaimAmount] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [saving, setSaving] = useState(false);
  const [accountForm, setAccountForm] = useState({ accountName: '', bankName: '', accountNumber: '', branchCode: '', accountType: 'business' });

  async function load() {
    if (!token) return;
    const [earnings, payoutsSummary, bankAccounts, payoutHistory] = await Promise.all([
      api<Row[]>('/driver/earnings', {}, token),
      api<Summary>('/payouts/summary', {}, token),
      api<BankAccount[]>('/payouts/bank-accounts', {}, token),
      api<Payout[]>('/payouts/history?partyType=driver', {}, token)
    ]);
    setRows(earnings);
    setSummary(payoutsSummary);
    setAccounts(bankAccounts);
    setHistory(payoutHistory);
    setSelectedAccountId(bankAccounts.find((item) => item.is_primary)?.id || bankAccounts[0]?.id || '');
  }

  useEffect(() => { void load(); }, [token]);
  const available = Number(summary?.driver?.available_balance || 0);
  const latestAccountId = useMemo(() => selectedAccountId || accounts.find((item) => item.is_primary)?.id || accounts[0]?.id || '', [selectedAccountId, accounts]);
  const canClaim = Number(claimAmount || 0) > 0 && Number(claimAmount) <= available && !!latestAccountId;

  async function addBankAccount() {
    if (!token) return;
    setSaving(true);
    try {
      await api('/payouts/bank-accounts', { method: 'POST', body: JSON.stringify({ holderScope: 'driver', accountName: accountForm.accountName, bankName: accountForm.bankName, accountNumber: accountForm.accountNumber, branchCode: accountForm.branchCode || null, accountType: accountForm.accountType, isPrimary: true }) }, token);
      setAccountForm({ accountName: '', bankName: '', accountNumber: '', branchCode: '', accountType: 'business' });
      await load();
    } finally { setSaving(false); }
  }

  async function requestClaim() {
    if (!token || !canClaim) return;
    setSaving(true);
    try {
      await api('/payouts/request', { method: 'POST', body: JSON.stringify({ partyType: 'driver', amount: Number(claimAmount), bankAccountId: latestAccountId || null, reference: 'Driver earnings claim' }) }, token);
      setClaimAmount('');
      await load();
      alert('Claim submitted for admin approval');
    } finally { setSaving(false); }
  }

  return <div className="page-shell"><div className="page-header"><div><div className="eyebrow">Driver finance</div><h1>Earnings & payout claims</h1><p>Track payout estimates by delivery, add your payout bank account, and claim only what you have earned.</p></div></div><div className="stats-grid"><section className="panel"><strong>Available balance</strong><div>{currency(available)}</div></section><section className="panel"><strong>Total earned</strong><div>{currency(summary?.driver?.gross_earnings || 0)}</div></section><section className="panel"><strong>Bank accounts</strong><div>{accounts.length}</div></section></div><div className="grid-two"><section className="panel"><div className="panel-header"><h3>Claim earnings</h3></div><label>Claim amount</label><input type="number" min="0" step="0.01" value={claimAmount} onChange={(e) => setClaimAmount(e.target.value)} placeholder="0.00" /><label>Payout account</label><select value={latestAccountId} onChange={(e) => setSelectedAccountId(e.target.value)}><option value="">Select bank account</option>{accounts.map((row) => <option key={row.id} value={row.id}>{row.bank_name} · {row.account_number_masked}</option>)}</select><button className="primary-btn block" disabled={!canClaim || saving} onClick={() => void requestClaim()}>{saving ? 'Submitting…' : 'Claim earnings'}</button><div className="muted">You cannot claim more than your available earned balance.</div></section><section className="panel"><div className="panel-header"><h3>Add payout account</h3></div><label>Account name</label><input value={accountForm.accountName} onChange={(e) => setAccountForm((s) => ({ ...s, accountName: e.target.value }))} /><label>Bank name</label><input value={accountForm.bankName} onChange={(e) => setAccountForm((s) => ({ ...s, bankName: e.target.value }))} /><label>Account number</label><input value={accountForm.accountNumber} onChange={(e) => setAccountForm((s) => ({ ...s, accountNumber: e.target.value }))} /><label>Branch code</label><input value={accountForm.branchCode} onChange={(e) => setAccountForm((s) => ({ ...s, branchCode: e.target.value }))} /><button className="secondary-btn block" disabled={saving} onClick={() => void addBankAccount()}>{saving ? 'Saving…' : 'Save payout account'}</button></section></div><section className="panel"><div className="panel-header"><h3>Earnings ledger</h3></div><DataTable headers={['Restaurant','Order','Status','Payout','Delivered']} rows={rows.map((row) => [row.restaurant_name, row.order_id.slice(0,8), row.status, currency(row.driver_payout_estimate), formatDate(row.delivered_at)])} /></section><section className="panel"><div className="panel-header"><h3>Claim history</h3></div><div className="stack-list">{history.map((row) => <div key={row.id} className="stack-item"><div><strong>{currency(row.amount)}</strong><div className="muted">{row.bank_name || 'Bank'} · {row.account_number_masked || '—'}</div></div><div><span className={`status-pill ${row.status}`}>{row.status}</span><div className="muted">{formatDate(row.created_at)}</div></div></div>)}</div></section></div>;
}
