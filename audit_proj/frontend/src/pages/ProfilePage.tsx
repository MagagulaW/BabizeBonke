import { useEffect, useState } from 'react';
import { api, resolveAssetUrl, uploadImage } from '../lib';
import { useAuth } from '../contexts/AuthContext';
import type { Session } from '../types';

type Profile = { id: string; email: string; full_name: string; phone: string; profile_image_url?: string | null };
type BankAccount = { id: string; account_name: string; bank_name: string; account_number_masked: string; is_primary: boolean };
type PayoutSummary = { driver?: { available_balance: string; gross_earnings: string }; restaurant?: { available_balance: string; app_commission_accrued: string; applied_commission_rate: string }; app?: { gross_collected: string; commission_retained: string; driver_obligations: string } };

export function ProfilePage() {
  const { token, user, applySession } = useAuth();
  const [profile, setProfile] = useState({ fullName: '', email: '', phone: '', password: '', profileImageUrl: '' });
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<PayoutSummary | null>(null);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [bankForm, setBankForm] = useState({ holderScope: user?.roles.includes('driver') ? 'driver' : 'restaurant', accountName: '', bankName: '', accountNumber: '', branchCode: '', accountType: '' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    api<Profile>('/auth/profile', {}, token).then((data) => {
      setProfile({ fullName: data.full_name, email: data.email, phone: data.phone || '', password: '', profileImageUrl: data.profile_image_url || '' });
    }).catch((err) => setError(err instanceof Error ? err.message : 'Failed to load profile'));
    api<PayoutSummary>('/payouts/summary', {}, token).then(setSummary).catch(() => undefined);
    api<BankAccount[]>('/payouts/bank-accounts', {}, token).then(setBankAccounts).catch(() => undefined);
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const session = await api<Session>('/auth/profile', { method: 'PUT', body: JSON.stringify({ fullName: profile.fullName, phone: profile.phone, password: profile.password, profileImageUrl: profile.profileImageUrl || null }) }, token);
      applySession(session);
      setProfile((s) => ({ ...s, password: '' }));
      setMessage('Profile updated');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Profile update failed');
    } finally {
      setLoading(false);
    }
  }


  async function saveBankAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError('');
    try {
      await api('/payouts/bank-accounts', { method: 'POST', body: JSON.stringify(bankForm) }, token);
      const [accounts, payoutSummary] = await Promise.all([
        api<BankAccount[]>('/payouts/bank-accounts', {}, token),
        api<PayoutSummary>('/payouts/summary', {}, token)
      ]);
      setBankAccounts(accounts);
      setSummary(payoutSummary);
      setBankForm((s) => ({ ...s, accountName: '', bankName: '', accountNumber: '', branchCode: '', accountType: '' }));
      setMessage('Payout account saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bank account save failed');
    }
  }

  async function handlePhoto(file?: File | null) {
    if (!file || !token) return;
    setUploading(true);
    setError('');
    try {
      const uploaded = await uploadImage(file, token);
      setProfile((s) => ({ ...s, profileImageUrl: uploaded.url }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image upload failed');
    } finally {
      setUploading(false);
    }
  }

  return <div className="page-shell">
    <div className="page-header"><div><div className="eyebrow">Profile</div><h1>Welcome, {user?.fullName || 'there'}</h1><p>Update your details.</p></div></div>
    <form className="panel" onSubmit={submit} style={{ maxWidth: 760 }}>
      {message ? <div className="panel-lite">{message}</div> : null}
      {error ? <div className="error-box">{error}</div> : null}
      <div className="form-grid-2">
        <div>
          <label>Profile photo</label>
          <div className="profile-photo-card">
            <div className="profile-photo-preview">{profile.profileImageUrl ? <img src={resolveAssetUrl(profile.profileImageUrl)} alt={profile.fullName || 'Profile'} /> : <span>{(profile.fullName || user?.fullName || 'U').slice(0, 1).toUpperCase()}</span>}</div>
            <div className="stack-inline">
              <input type="file" accept="image/*" onChange={(e) => void handlePhoto(e.target.files?.[0])} />
              <div className="muted">{uploading ? 'Uploading image…' : 'Upload a clear profile photo.'}</div>
            </div>
          </div>
        </div>
        <div><label>Full name</label><input value={profile.fullName} onChange={(e) => setProfile((s) => ({ ...s, fullName: e.target.value }))} /></div>
        <div><label>Email</label><input value={profile.email} readOnly /></div>
        <div><label>Phone</label><input value={profile.phone} onChange={(e) => setProfile((s) => ({ ...s, phone: e.target.value }))} placeholder="+27821234567" /></div>
        <div><label>New password</label><input type="password" value={profile.password} onChange={(e) => setProfile((s) => ({ ...s, password: e.target.value }))} placeholder="Leave blank to keep current password" /></div>
      </div>
      <button className="primary-btn" disabled={loading}>{loading ? 'Saving…' : 'Save profile'}</button>
    </form>
    <div className="grid-two" style={{ marginTop: 18 }}>
      <section className="panel">
        <div className="panel-header"><h3>Payout overview</h3></div>
        <div className="feature-list">
          {summary?.driver ? <div className="feature-item">Driver available balance: <strong>{summary.driver.available_balance}</strong></div> : null}
          {summary?.restaurant ? <>
            <div className="feature-item">Restaurant available balance: <strong>{summary.restaurant.available_balance}</strong></div>
            <div className="feature-item">App commission retained: <strong>{summary.restaurant.app_commission_accrued}</strong></div>
            <div className="feature-item">Applied commission rate: <strong>{summary.restaurant.applied_commission_rate}%</strong></div>
          </> : null}
          {summary?.app ? <div className="feature-item">Platform gross collected: <strong>{summary.app.gross_collected}</strong></div> : null}
        </div>
      </section>
      <section className="panel">
        <div className="panel-header"><h3>Payout account</h3></div>
        <form className="form-grid-2" onSubmit={saveBankAccount}>
          <div><label>Account name</label><input value={bankForm.accountName} onChange={(e) => setBankForm((s) => ({ ...s, accountName: e.target.value }))} /></div>
          <div><label>Bank name</label><input value={bankForm.bankName} onChange={(e) => setBankForm((s) => ({ ...s, bankName: e.target.value }))} /></div>
          <div><label>Account number</label><input value={bankForm.accountNumber} onChange={(e) => setBankForm((s) => ({ ...s, accountNumber: e.target.value }))} /></div>
          <div><label>Branch code</label><input value={bankForm.branchCode} onChange={(e) => setBankForm((s) => ({ ...s, branchCode: e.target.value }))} /></div>
          <div><label>Account type</label><input value={bankForm.accountType} onChange={(e) => setBankForm((s) => ({ ...s, accountType: e.target.value }))} /></div>
          <div><label>Payout scope</label><select value={bankForm.holderScope} onChange={(e) => setBankForm((s) => ({ ...s, holderScope: e.target.value }))}><option value="driver">Driver</option><option value="restaurant">Restaurant</option></select></div>
          <div className="form-full"><button className="primary-btn">Save payout account</button></div>
        </form>
        <div className="stack-list" style={{ marginTop: 12 }}>
          {bankAccounts.map((account) => <div className="stack-item" key={account.id}><div><strong>{account.bank_name}</strong><div className="muted">{account.account_name}</div></div><div>{account.account_number_masked}{account.is_primary ? ' · Primary' : ''}</div></div>)}
        </div>
      </section>
    </div>
  </div>;
}
