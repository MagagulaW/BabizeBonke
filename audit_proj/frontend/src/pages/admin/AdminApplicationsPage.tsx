import { useEffect, useMemo, useState } from 'react';
import { api, formatDate, resolveAssetUrl } from '../../lib';
import { useAuth } from '../../contexts/AuthContext';

type Driver = {
  id: string;
  full_name: string;
  email: string;
  phone?: string | null;
  onboarding_status: string;
  license_number?: string | null;
  license_expiry_date?: string | null;
  national_id_number?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  vehicle_type?: string | null;
  make?: string | null;
  model?: string | null;
  year?: number | string | null;
  color?: string | null;
  registration_number?: string | null;
};

type Restaurant = {
  id: string;
  display_name: string;
  legal_name: string;
  status: string;
  support_email?: string | null;
  support_phone?: string | null;
  created_at: string;
  city?: string | null;
  province?: string | null;
  commission_rate?: string | number;
  logo_url?: string | null;
  banner_url?: string | null;
};

type TabKey = 'pending-drivers' | 'pending-restaurants' | 'approved' | 'rejected';
type TypeFilter = 'all' | 'drivers' | 'restaurants';
type SortFilter = 'newest' | 'oldest' | 'name';

const tabOptions: { key: TabKey; label: string }[] = [
  { key: 'pending-drivers', label: 'Pending Drivers' },
  { key: 'pending-restaurants', label: 'Pending Restaurants' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' }
];

function includesText(values: Array<string | number | null | undefined>, search: string) {
  if (!search) return true;
  const haystack = values.filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(search);
}

function sortDrivers(rows: Driver[], sortBy: SortFilter) {
  const copy = [...rows];
  if (sortBy === 'name') return copy.sort((a, b) => a.full_name.localeCompare(b.full_name));
  if (sortBy === 'oldest') return copy.sort((a, b) => a.full_name.localeCompare(b.full_name));
  return copy.sort((a, b) => a.full_name.localeCompare(b.full_name));
}

function sortRestaurants(rows: Restaurant[], sortBy: SortFilter) {
  const copy = [...rows];
  if (sortBy === 'name') return copy.sort((a, b) => a.display_name.localeCompare(b.display_name));
  if (sortBy === 'oldest') return copy.sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
  return copy.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
}

export function AdminApplicationsPage() {
  const { token } = useAuth();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>('pending-drivers');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [provinceFilter, setProvinceFilter] = useState('all');
  const [sortBy, setSortBy] = useState<SortFilter>('newest');

  async function load() {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const [driverRows, restaurantRows] = await Promise.all([
        api<Driver[]>('/admin/drivers', {}, token),
        api<Restaurant[]>('/admin/restaurants', {}, token)
      ]);
      setDrivers(driverRows);
      setRestaurants(restaurantRows);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load applications');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [token]);

  async function updateDriverStatus(id: string, status: 'approved' | 'rejected' | 'suspended') {
    if (!token) return;
    try {
      await api(`/admin/drivers/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }, token);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update driver application');
    }
  }

  async function updateRestaurantStatus(id: string, status: 'approved' | 'rejected' | 'suspended') {
    if (!token) return;
    try {
      await api(`/admin/restaurants/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }, token);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update restaurant application');
    }
  }

  const counts = useMemo(() => ({
    pendingDrivers: drivers.filter((d) => d.onboarding_status === 'pending').length,
    pendingRestaurants: restaurants.filter((r) => r.status === 'pending_review').length,
    approved: drivers.filter((d) => d.onboarding_status === 'approved').length + restaurants.filter((r) => ['approved', 'active'].includes(r.status)).length,
    rejected: drivers.filter((d) => d.onboarding_status === 'rejected').length + restaurants.filter((r) => r.status === 'rejected').length
  }), [drivers, restaurants]);

  const normalizedSearch = search.trim().toLowerCase();
  const provinceOptions = useMemo(() => {
    const items = Array.from(new Set(restaurants.map((r) => r.province).filter(Boolean) as string[]));
    return items.sort((a, b) => a.localeCompare(b));
  }, [restaurants]);

  const pendingDrivers = useMemo(() => sortDrivers(
    drivers.filter((d) => d.onboarding_status === 'pending').filter((d) =>
      includesText([
        d.full_name,
        d.email,
        d.phone,
        d.registration_number,
        d.vehicle_type,
        d.make,
        d.model,
        d.license_number
      ], normalizedSearch)
    ),
    sortBy
  ), [drivers, normalizedSearch, sortBy]);

  const pendingRestaurants = useMemo(() => sortRestaurants(
    restaurants
      .filter((r) => r.status === 'pending_review')
      .filter((r) => provinceFilter === 'all' || (r.province || '').toLowerCase() === provinceFilter.toLowerCase())
      .filter((r) => includesText([
        r.display_name,
        r.legal_name,
        r.support_email,
        r.support_phone,
        r.city,
        r.province
      ], normalizedSearch)),
    sortBy
  ), [restaurants, normalizedSearch, provinceFilter, sortBy]);

  const approvedDrivers = useMemo(() => sortDrivers(
    drivers.filter((d) => d.onboarding_status === 'approved').filter((d) =>
      includesText([d.full_name, d.email, d.phone, d.registration_number, d.vehicle_type, d.make, d.model], normalizedSearch)
    ),
    sortBy
  ), [drivers, normalizedSearch, sortBy]);

  const approvedRestaurants = useMemo(() => sortRestaurants(
    restaurants
      .filter((r) => ['approved', 'active'].includes(r.status))
      .filter((r) => provinceFilter === 'all' || (r.province || '').toLowerCase() === provinceFilter.toLowerCase())
      .filter((r) => includesText([r.display_name, r.legal_name, r.support_email, r.support_phone, r.city, r.province], normalizedSearch)),
    sortBy
  ), [restaurants, normalizedSearch, provinceFilter, sortBy]);

  const rejectedDrivers = useMemo(() => sortDrivers(
    drivers.filter((d) => d.onboarding_status === 'rejected').filter((d) =>
      includesText([d.full_name, d.email, d.phone, d.registration_number], normalizedSearch)
    ),
    sortBy
  ), [drivers, normalizedSearch, sortBy]);

  const rejectedRestaurants = useMemo(() => sortRestaurants(
    restaurants
      .filter((r) => r.status === 'rejected')
      .filter((r) => provinceFilter === 'all' || (r.province || '').toLowerCase() === provinceFilter.toLowerCase())
      .filter((r) => includesText([r.display_name, r.legal_name, r.support_email, r.support_phone, r.city, r.province], normalizedSearch)),
    sortBy
  ), [restaurants, normalizedSearch, provinceFilter, sortBy]);

  const showingTypeFilter = activeTab === 'approved' || activeTab === 'rejected';
  const showingProvinceFilter = activeTab !== 'pending-drivers';

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1>Applications</h1>
          <p>Search, filter, and review driver and restaurant applications.</p>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="tab-row" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
          {tabOptions.map((tab) => {
            const count = tab.key === 'pending-drivers' ? counts.pendingDrivers : tab.key === 'pending-restaurants' ? counts.pendingRestaurants : tab.key === 'approved' ? counts.approved : counts.rejected;
            return (
              <button
                key={tab.key}
                type="button"
                className={`chip-btn ${activeTab === tab.key ? '' : 'secondary'}`}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label} <span className="muted">({count})</span>
              </button>
            );
          })}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <label>
            <div className="field-label">Search</div>
            <input
              placeholder="Name, email, phone, registration, city..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>

          {showingTypeFilter ? (
            <label>
              <div className="field-label">Type</div>
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}>
                <option value="all">All</option>
                <option value="drivers">Drivers</option>
                <option value="restaurants">Restaurants</option>
              </select>
            </label>
          ) : null}

          {showingProvinceFilter ? (
            <label>
              <div className="field-label">Province</div>
              <select value={provinceFilter} onChange={(e) => setProvinceFilter(e.target.value)}>
                <option value="all">All provinces</option>
                {provinceOptions.map((province) => <option key={province} value={province}>{province}</option>)}
              </select>
            </label>
          ) : null}

          <label>
            <div className="field-label">Sort</div>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortFilter)}>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="name">Name A–Z</option>
            </select>
          </label>
        </div>
      </div>

      {error ? <div className="error-box">{error}</div> : null}
      {loading ? <div className="panel"><div className="muted">Loading applications…</div></div> : null}

      {!loading && activeTab === 'pending-drivers' ? (
        <div className="stack-list">
          {pendingDrivers.length === 0 ? <div className="panel"><div className="muted">No matching pending driver applications.</div></div> : null}
          {pendingDrivers.map((driver) => (
            <section className="panel" key={driver.id}>
              <div className="panel-header">
                <div>
                  <h3>{driver.full_name}</h3>
                  <div className="muted">{driver.email}{driver.phone ? ` · ${driver.phone}` : ''}</div>
                </div>
                <span className="status-pill pending">pending</span>
              </div>
              <div className="stack-item"><div><strong>Vehicle</strong><div className="muted">{[driver.vehicle_type, driver.make, driver.model, driver.year].filter(Boolean).join(' · ') || '—'}</div></div><div><strong>Registration</strong><div className="muted">{driver.registration_number || '—'}</div></div></div>
              <div className="stack-item"><div><strong>License</strong><div className="muted">{driver.license_number || '—'}{driver.license_expiry_date ? ` · Expires ${formatDate(driver.license_expiry_date)}` : ''}</div></div><div><strong>Emergency contact</strong><div className="muted">{driver.emergency_contact_name || '—'}{driver.emergency_contact_phone ? ` · ${driver.emergency_contact_phone}` : ''}</div></div></div>
              <div className="actions">
                <button className="chip-btn" onClick={() => updateDriverStatus(driver.id, 'approved')}>Approve</button>
                <button className="chip-btn danger" onClick={() => updateDriverStatus(driver.id, 'rejected')}>Reject</button>
              </div>
            </section>
          ))}
        </div>
      ) : null}

      {!loading && activeTab === 'pending-restaurants' ? (
        <div className="stack-list">
          {pendingRestaurants.length === 0 ? <div className="panel"><div className="muted">No matching pending restaurant applications.</div></div> : null}
          {pendingRestaurants.map((restaurant) => (
            <section className="panel" key={restaurant.id}>
              <div className="panel-header">
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <div className="restaurant-logo">{restaurant.logo_url ? <img src={resolveAssetUrl(restaurant.logo_url)} alt={restaurant.display_name} /> : '🍽️'}</div>
                  <div>
                    <h3>{restaurant.display_name}</h3>
                    <div className="muted">{restaurant.support_email || restaurant.legal_name}</div>
                  </div>
                </div>
                <span className="status-pill pending_review">pending review</span>
              </div>
              <div className="stack-item"><div><strong>Legal name</strong><div className="muted">{restaurant.legal_name || '—'}</div></div><div><strong>Contact</strong><div className="muted">{restaurant.support_phone || '—'}</div></div></div>
              <div className="stack-item"><div><strong>Location</strong><div className="muted">{[restaurant.city, restaurant.province].filter(Boolean).join(', ') || '—'}</div></div><div><strong>Submitted</strong><div className="muted">{formatDate(restaurant.created_at)}</div></div></div>
              <div className="actions">
                <button className="chip-btn" onClick={() => updateRestaurantStatus(restaurant.id, 'approved')}>Approve</button>
                <button className="chip-btn danger" onClick={() => updateRestaurantStatus(restaurant.id, 'rejected')}>Reject</button>
              </div>
            </section>
          ))}
        </div>
      ) : null}

      {!loading && activeTab === 'approved' ? (
        <div className="stack-list">
          {(typeFilter === 'all' || typeFilter === 'restaurants') && approvedRestaurants.map((restaurant) => (
            <section className="panel" key={`restaurant-${restaurant.id}`}>
              <div className="panel-header">
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <div className="restaurant-logo">{restaurant.logo_url ? <img src={resolveAssetUrl(restaurant.logo_url)} alt={restaurant.display_name} /> : '🍽️'}</div>
                  <div>
                    <h3>{restaurant.display_name}</h3>
                    <div className="muted">Restaurant · {[restaurant.city, restaurant.province].filter(Boolean).join(', ') || 'Location pending'}</div>
                  </div>
                </div>
                <span className={`status-pill ${restaurant.status}`}>{restaurant.status}</span>
              </div>
              <div className="actions">
                <button className="chip-btn warning" onClick={() => updateRestaurantStatus(restaurant.id, 'suspended')}>Suspend</button>
              </div>
            </section>
          ))}
          {(typeFilter === 'all' || typeFilter === 'drivers') && approvedDrivers.map((driver) => (
            <section className="panel" key={`driver-${driver.id}`}>
              <div className="panel-header">
                <div>
                  <h3>{driver.full_name}</h3>
                  <div className="muted">Driver · {driver.registration_number || 'Vehicle registration pending'}</div>
                </div>
                <span className="status-pill approved">approved</span>
              </div>
              <div className="actions">
                <button className="chip-btn warning" onClick={() => updateDriverStatus(driver.id, 'suspended')}>Suspend</button>
              </div>
            </section>
          ))}
          {((typeFilter === 'all' || typeFilter === 'drivers') ? approvedDrivers.length : 0) + ((typeFilter === 'all' || typeFilter === 'restaurants') ? approvedRestaurants.length : 0) === 0 ? <div className="panel"><div className="muted">No matching approved applications.</div></div> : null}
        </div>
      ) : null}

      {!loading && activeTab === 'rejected' ? (
        <div className="stack-list">
          {(typeFilter === 'all' || typeFilter === 'restaurants') && rejectedRestaurants.map((restaurant) => (
            <section className="panel" key={`restaurant-${restaurant.id}`}>
              <div className="panel-header">
                <div>
                  <h3>{restaurant.display_name}</h3>
                  <div className="muted">Restaurant · {restaurant.support_email || restaurant.legal_name}</div>
                </div>
                <span className="status-pill rejected">rejected</span>
              </div>
            </section>
          ))}
          {(typeFilter === 'all' || typeFilter === 'drivers') && rejectedDrivers.map((driver) => (
            <section className="panel" key={`driver-${driver.id}`}>
              <div className="panel-header">
                <div>
                  <h3>{driver.full_name}</h3>
                  <div className="muted">Driver · {driver.email}</div>
                </div>
                <span className="status-pill rejected">rejected</span>
              </div>
            </section>
          ))}
          {((typeFilter === 'all' || typeFilter === 'drivers') ? rejectedDrivers.length : 0) + ((typeFilter === 'all' || typeFilter === 'restaurants') ? rejectedRestaurants.length : 0) === 0 ? <div className="panel"><div className="muted">No matching rejected applications.</div></div> : null}
        </div>
      ) : null}
    </div>
  );
}
