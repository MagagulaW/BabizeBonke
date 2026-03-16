import { useEffect, useRef, useState } from 'react';
import { api, currency, formatDate } from '../../lib';
import { connectRealtime } from '../../realtime';
import { useAuth } from '../../contexts/AuthContext';
import { OrderCommunicationPanel } from '../../components/OrderCommunicationPanel';

type Delivery = { id: string; order_id: string; status: string; is_mine: boolean; restaurant_name: string; customer_name?: string | null; customer_phone?: string | null; address_label?: string | null; address_line1: string; address_line2?: string | null; suburb?: string | null; city: string; province: string; postal_code?: string | null; driver_payout_estimate: string | number; total_amount: string | number; placed_at: string; special_instructions?: string | null; delivery_instructions?: string | null; customer_nav_url?: string | null; restaurant_nav_url?: string | null; };
const statusFlow = ['accepted', 'en_route_to_pickup', 'arrived_at_pickup', 'picked_up', 'en_route_to_dropoff', 'arrived_at_dropoff', 'delivered'] as const;

export function DriverDeliveriesPage() {
  const { token, user } = useAuth();
  const [rows, setRows] = useState<Delivery[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [sharing, setSharing] = useState(false);
  const [locationLabel, setLocationLabel] = useState('Not sharing');
  const [payoutByDelivery, setPayoutByDelivery] = useState<Record<string, string>>({});
  const watchRef = useRef<number | null>(null);

  async function load() {
    if (!token) return;
    api<Delivery[]>('/driver/deliveries', {}, token).then((data) => {
      setRows(data);
      const mine = data.find((row) => row.is_mine);
      if (!selectedOrderId && mine?.order_id) setSelectedOrderId(mine.order_id);
    }).catch(console.error);
  }

  useEffect(() => {
    void load();
    if (!token) return;
    const socket = connectRealtime(token);
    const refresh = () => { void load(); };
    socket.on('delivery:accepted', refresh);
    socket.on('order:status_changed', refresh);
    socket.on('delivery:dispatch_ready', refresh);
    const intervalId = window.setInterval(refresh, 10000);
    return () => {
      window.clearInterval(intervalId);
      socket.disconnect();
      if (watchRef.current !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchRef.current);
    };
  }, [token]);

  async function accept(id: string, orderId: string) {
    if (!token) return;
    const requestedPayout = payoutByDelivery[id] ? Number(payoutByDelivery[id]) : undefined;
    await api(`/driver/deliveries/${id}/accept`, { method: 'POST', body: JSON.stringify({ requestedPayout }) }, token);
    setSelectedOrderId(orderId);
    await load();
    if (!sharing) void startSharing();
  }

  async function updateStatus(id: string, status: typeof statusFlow[number]) {
    if (!token) return;
    await api(`/driver/deliveries/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }, token);
    await load();
  }

  async function postLocation(latitude: number, longitude: number, coords?: GeolocationCoordinates) {
    if (!token) return;
    await api('/driver/location', { method: 'POST', body: JSON.stringify({ latitude, longitude, speedKph: coords?.speed ? coords.speed * 3.6 : 0, headingDeg: coords?.heading ?? 0, accuracyM: coords?.accuracy ?? 0 }) }, token);
    setLocationLabel(`Live at ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
  }

  async function startSharing() {
    if (!navigator.geolocation) { alert('Geolocation is not supported on this device'); return; }
    setSharing(true);
    setLocationLabel('Requesting location permission…');
    watchRef.current = navigator.geolocation.watchPosition(
      (position) => { void postLocation(position.coords.latitude, position.coords.longitude, position.coords); },
      (error) => { setSharing(false); setLocationLabel(error.message || 'Location sharing failed'); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
    );
  }

  function stopSharing() {
    if (watchRef.current !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = null;
    setSharing(false);
    setLocationLabel('Not sharing');
  }

  return <div className="page-shell"><div className="page-header"><div><div className="eyebrow"></div><h1>Deliveries</h1><p>Accept work, lock it to your profile, update delivery status, and keep the customer updated with live location.</p></div><div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}><button className="secondary-btn" onClick={sharing ? stopSharing : () => void startSharing()}>{sharing ? 'Stop live tracking' : 'Start live tracking'}</button><button className="primary-btn" onClick={() => { if (sharing && navigator.geolocation) navigator.geolocation.getCurrentPosition((pos) => void postLocation(pos.coords.latitude, pos.coords.longitude, pos.coords), () => undefined); else void startSharing(); }}>Send location now</button></div></div><div className="muted" style={{ marginBottom: 12 }}>{locationLabel}</div><div className="grid-two"><div className="stack-list">{rows.map((row) => <section className={`panel selectable ${selectedOrderId === row.order_id ? 'selected' : ''}`} key={row.id} onClick={() => setSelectedOrderId(row.order_id)}><div className="panel-header"><h3>{row.restaurant_name}</h3><span className={`status-pill ${row.status}`}>{row.status}</span></div><div className="stack-item"><div><strong>Order #{row.order_id.slice(0, 8)}</strong><div>{row.customer_name || 'Customer'}{row.customer_phone ? ` · ${row.customer_phone}` : ''}</div><div>{row.address_label ? `${row.address_label} · ` : ''}{row.address_line1 || 'Pickup order'}{row.address_line2 ? `, ${row.address_line2}` : ''}{row.suburb ? `, ${row.suburb}` : ''} {row.city ? `· ${row.city}, ${row.province}` : ''}{row.postal_code ? ` ${row.postal_code}` : ''}</div><div className="muted">Placed {formatDate(row.placed_at)}</div>{row.special_instructions ? <div className="muted">Order note: {row.special_instructions}</div> : null}{row.delivery_instructions ? <div className="muted">Delivery note: {row.delivery_instructions}</div> : null}</div><div><div><strong>{currency(row.driver_payout_estimate)}</strong> payout</div><div className="muted">Customer order {currency(row.total_amount)}</div></div></div><div className="actions">{!row.is_mine ? <>
                    <input className="text-input" style={{ maxWidth: 160 }} type="number" min={0} step="0.01" value={payoutByDelivery[row.id] ?? String(row.driver_payout_estimate ?? '')} onChange={(e) => setPayoutByDelivery((prev) => ({ ...prev, [row.id]: e.target.value }))} placeholder="Payout amount" onClick={(e) => e.stopPropagation()} />
                    <button className="primary-btn" onClick={(e) => { e.stopPropagation(); void accept(row.id, row.order_id); }}>Accept delivery</button>
                  </> : <>
                    {statusFlow.map((status) => <button key={status} className="chip-btn" onClick={(e) => { e.stopPropagation(); void updateStatus(row.id, status); }}>{status}</button>)}
                    {row.restaurant_nav_url ? <a className="chip-btn" href={row.restaurant_nav_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Navigate restaurant</a> : null}
                    {row.customer_nav_url ? <a className="chip-btn" href={row.customer_nav_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Navigate customer</a> : null}
                  </>}</div></section>)}</div>{token && user && selectedOrderId ? <OrderCommunicationPanel orderId={selectedOrderId} token={token} currentUserId={user.id} roleLabel="Driver line to customer" /> : <section className="panel"><div className="muted">Accept or select a delivery to open chat and calling tools.</div></section>}</div></div>;
}
