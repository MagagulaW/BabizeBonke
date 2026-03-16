import { useEffect, useState } from 'react';
import { api } from '../../lib';
import { useAuth } from '../../contexts/AuthContext';

type Driver = { id: string; full_name: string; email: string; onboarding_status: string; available_for_dispatch: boolean; rating: string | number; total_deliveries: number; registration_number?: string | null; vehicle_type?: string | null; phone?: string | null };

export function AdminDriversPage() {
  const { token } = useAuth();
  const [rows, setRows] = useState<Driver[]>([]);
  const [error, setError] = useState('');
  async function load() { if (!token) return; try { setRows(await api<Driver[]>('/admin/drivers', {}, token)); } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load drivers'); } }
  useEffect(() => { void load(); }, [token]);
  async function updateStatus(id: string, status: 'approved' | 'rejected' | 'suspended') { if (!token) return; try { await api(`/admin/drivers/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }, token); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Update failed'); } }
  return <div className="page-shell"><div className="page-header"><div><h1>Drivers</h1><p>Review and approve driver applications.</p></div></div>{error ? <div className="error-box">{error}</div> : null}<div className="stack-list">{rows.map((row) => <section className="panel" key={row.id}><div className="panel-header"><div><h3>{row.full_name}</h3><div className="muted">{row.email}{row.phone ? ` · ${row.phone}` : ''}</div></div><span className={`status-pill ${row.onboarding_status}`}>{row.onboarding_status}</span></div><div className="stack-item"><div><strong>Vehicle</strong><div className="muted">{row.vehicle_type || '—'}{row.registration_number ? ` · ${row.registration_number}` : ''}</div></div><div><strong>Deliveries</strong><div className="muted">{row.total_deliveries} total · Rating {row.rating}</div></div></div><div className="actions"><button className="chip-btn" onClick={() => updateStatus(row.id, 'approved')}>Approve</button><button className="chip-btn warning" onClick={() => updateStatus(row.id, 'suspended')}>Suspend</button><button className="chip-btn danger" onClick={() => updateStatus(row.id, 'rejected')}>Reject</button></div></section>)}</div></div>;
}
