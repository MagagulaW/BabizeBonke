import { useEffect, useState } from 'react';
import { api } from '../../lib';
import { useAuth } from '../../contexts/AuthContext';
import { DataTable } from '../../components/DataTable';

type Customer = { id: string; full_name: string; email: string; loyalty_points: number; preferred_language: string; orders: number };

export function AdminCustomersPage() {
  const { token } = useAuth();
  const [rows, setRows] = useState<Customer[]>([]);

  useEffect(() => {
    if (!token) return;
    api<Customer[]>('/admin/customers', {}, token).then(setRows).catch(console.error);
  }, [token]);

  return (
    <div className="page-shell">
      <div className="page-header"><div><div className="eyebrow">Admin console</div><h1>Customers</h1><p>Customer accounts, loyalty and order volume.</p></div></div>
      <section className="panel">
        <DataTable headers={['Name', 'Email', 'Loyalty points', 'Language', 'Orders']} rows={rows.map((row) => [row.full_name, row.email, row.loyalty_points, row.preferred_language || 'en', row.orders])} />
      </section>
    </div>
  );
}
