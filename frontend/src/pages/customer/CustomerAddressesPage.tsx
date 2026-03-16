import { useEffect, useState } from 'react';
import { api } from '../../lib';
import { useAuth } from '../../contexts/AuthContext';
import { DataTable } from '../../components/DataTable';
import { MapPicker } from '../../components/MapComponents';

type Address = {
  id: string;
  label: string;
  address_line1: string;
  address_line2?: string | null;
  suburb?: string | null;
  city: string;
  province: string;
  postal_code?: string | null;
  delivery_instructions?: string | null;
  is_default: boolean;
  latitude?: number;
  longitude?: number;
};

export function CustomerAddressesPage() {
  const { token } = useAuth();
  const [rows, setRows] = useState<Address[]>([]);
  const [usingLocation, setUsingLocation] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [form, setForm] = useState({
    label: 'Home',
    addressLine1: '14 Ferreira Street',
    addressLine2: '',
    suburb: 'West Acres',
    city: 'Mbombela',
    province: 'Mpumalanga',
    postalCode: '1200',
    deliveryInstructions: '',
    latitude: -25.4745,
    longitude: 30.9703,
    isDefault: false
  });

  async function load() {
    if (!token) return;
    api<Address[]>('/customer/addresses', {}, token).then(setRows).catch(console.error);
  }

  useEffect(() => { load(); }, [token]);

  function useMyLocation() {
    if (!navigator.geolocation) {
      setLocationError('This browser does not support location access.');
      return;
    }
    setUsingLocation(true);
    setLocationError('');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setForm((current) => ({
          ...current,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        }));
        setUsingLocation(false);
      },
      (error) => {
        setLocationError(error.message || 'Location access was denied.');
        setUsingLocation(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    await api('/customer/addresses', { method: 'POST', body: JSON.stringify(form) }, token);
    await load();
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <div className="eyebrow">Customer app</div>
          <h1>Saved addresses</h1>
          <p>Choose an exact delivery pin, then add directions that help the driver find you faster.</p>
        </div>
      </div>

      <div className="grid-two">
        <section className="panel">
          <DataTable
            headers={['Label', 'Address', 'City', 'Province', 'Instructions', 'Default']}
            rows={rows.map((row) => [
              row.label,
              [row.address_line1, row.address_line2, row.suburb].filter(Boolean).join(', '),
              row.city,
              row.province,
              row.delivery_instructions || '—',
              row.is_default ? 'Yes' : 'No'
            ])}
          />
        </section>

        <section className="panel form-panel">
          <div className="panel-header"><h3>Add address</h3></div>
          <form onSubmit={submit}>
            <label>Label</label>
            <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />

            <label>Address line 1</label>
            <input value={form.addressLine1} onChange={(e) => setForm({ ...form, addressLine1: e.target.value })} />

            <label>Address line 2</label>
            <input value={form.addressLine2} onChange={(e) => setForm({ ...form, addressLine2: e.target.value })} />

            <label>Location / Suburb</label>
            <input value={form.suburb} onChange={(e) => setForm({ ...form, suburb: e.target.value })} />

            <label>City</label>
            <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />

            <label>Province</label>
            <input value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value })} />

            <label>Postal code</label>
            <input value={form.postalCode} onChange={(e) => setForm({ ...form, postalCode: e.target.value })} />

            <label>Extra delivery information</label>
            <textarea
              rows={4}
              value={form.deliveryInstructions}
              onChange={(e) => setForm({ ...form, deliveryInstructions: e.target.value })}
              placeholder="Gate code, house colour, nearest landmark, call on arrival, floor number, unit number"
            />

            <div className="panel-header compact">
              <strong>Delivery pin</strong>
              <button type="button" className="secondary-btn inline-btn" onClick={useMyLocation} disabled={usingLocation}>
                {usingLocation ? 'Locating...' : 'Use my current location'}
              </button>
            </div>
            {locationError ? <div className="form-error">{locationError}</div> : null}
            <div className="muted">Allow location access, then tap the map to fine-tune the exact dropoff point.</div>
            <MapPicker value={{ latitude: Number(form.latitude), longitude: Number(form.longitude) }} onChange={(value) => setForm((current) => ({ ...current, latitude: value.latitude, longitude: value.longitude }))} height={260} />
            <div className="map-coords">Lat {Number(form.latitude).toFixed(5)} · Lng {Number(form.longitude).toFixed(5)}</div>

            <label className="checkbox-row"><input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} /> Set as default delivery address</label>

            <button className="primary-btn block">Save address</button>
          </form>
        </section>
      </div>
    </div>
  );
}
