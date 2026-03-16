import { useEffect, useState } from 'react';
import { api, formatDate } from '../../lib';
import { useAuth } from '../../contexts/AuthContext';
import { DataTable } from '../../components/DataTable';

type UserRow = { id: string; full_name: string; email: string; phone: string | null; status: string; is_active: boolean; created_at: string; roles: string[] };

export function AdminUsersPage() {
  const { token } = useAuth();
  const [rows, setRows] = useState<UserRow[]>([]);

  useEffect(() => {
    if (!token) return;
    api<UserRow[]>('/admin/users', {}, token).then(setRows).catch(console.error);
  }, [token]);

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <div className="eyebrow">Admin console</div>
          <h1>Users</h1>
          <p>Review all platform users and their role access.</p>
        </div>
      </div>
      <div className="panel">
        <DataTable
          headers={["Name", "Email", "Roles", "Status", "Created"]}
          rows={rows.map((row) => [
            <div><strong>{row.full_name}</strong><div className="muted">{row.phone || 'No phone'}</div></div>,
            row.email,
            row.roles.join(', '),
            <span className={`status-pill ${row.status}`}>{row.status}</span>,
            formatDate(row.created_at)
          ])}
        />
      </div>
    </div>
  );
}
