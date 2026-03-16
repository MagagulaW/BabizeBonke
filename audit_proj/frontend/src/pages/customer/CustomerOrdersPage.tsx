
import { useEffect, useMemo, useState } from 'react';
import { api, currency, formatDate, resolveAssetUrl } from '../../lib';
import { connectRealtime } from '../../realtime';
import { useAuth } from '../../contexts/AuthContext';
import { OrderCommunicationPanel } from '../../components/OrderCommunicationPanel';
import { LiveTrackingMap } from '../../components/MapComponents';

type Order = { id: string; restaurant_name: string; status: string; delivery_status: string; order_type: string; total_amount: string | number; placed_at: string; driver_name?: string | null; vehicle_registration?: string | null };
type Tracking = {
  order: {
    id: string;
    status: string;
    restaurant_name: string;
    total_amount: string | number;
    order_type: string;
    placed_at: string;
    delivery_status?: string | null;
    driver_name?: string | null;
    driver_phone?: string | null;
    vehicle_registration?: string | null;
    driver_image_url?: string | null;
    pickup_eta_mins?: number | null;
    dropoff_eta_mins?: number | null;
  };
  driverLocation: { latitude: number; longitude: number; speed_kph?: number | null; heading_deg?: number | null; recorded_at: string } | null;
  orderEvents: Array<{ status: string; notes?: string | null; created_at: string }>;
  chatSummary: { message_count: number; last_message_at?: string | null };
  pickupLocation?: { latitude: number; longitude: number } | null;
  dropoffLocation?: { latitude: number; longitude: number } | null;
};

export function CustomerOrdersPage() {
  const { token, user } = useAuth();
  const [rows, setRows] = useState<Order[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string>('');
  const [tracking, setTracking] = useState<Tracking | null>(null);
  const [cancelReason, setCancelReason] = useState('Ordered by mistake');

  useEffect(() => {
    if (!token) return;
    api<Order[]>('/customer/orders', {}, token).then((data) => {
      setRows(data);
      if (!selectedOrderId && data[0]?.id) setSelectedOrderId(data[0].id);
    }).catch(console.error);
  }, [token]);

  useEffect(() => {
    if (!token || !selectedOrderId) return;
    let active = true;
    const loadTracking = async () => {
      try {
        const data = await api<Tracking>(`/customer/orders/${selectedOrderId}/tracking`, {}, token);
        if (active) setTracking(data);
      } catch (error) {
        console.error(error);
      }
    };
    void loadTracking();
    const socket = connectRealtime(token);
    socket.emit('order:join', selectedOrderId);
    const refresh = (event: any) => {
      if (event?.orderId === selectedOrderId) void loadTracking();
    };
    socket.on('order:status_changed', refresh);
    socket.on('driver:location_updated', refresh);
    socket.on('delivery:accepted', refresh);
    return () => {
      active = false;
      socket.emit('order:leave', selectedOrderId);
      socket.disconnect();
    };
  }, [token, selectedOrderId]);

  const liveLabel = useMemo(() => {
    if (!tracking?.driverLocation) return 'Waiting for driver location';
    const { latitude, longitude } = tracking.driverLocation;
    return `Driver near ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
  }, [tracking]);

  async function cancelOrder() {
    if (!token || !selectedOrderId) return;
    await api(`/customer/orders/${selectedOrderId}/cancel`, { method: 'POST', body: JSON.stringify({ reason: cancelReason }) }, token);
    const data = await api<Order[]>('/customer/orders', {}, token);
    setRows(data);
    const trackingData = await api<Tracking>(`/customer/orders/${selectedOrderId}/tracking`, {}, token).catch(() => null);
    setTracking(trackingData as any);
  }

  return <div className="page-shell">
    <div className="page-header"><div><div className="eyebrow"></div><h1>Your orders</h1><p>Follow live delivery progress, instant order status changes, chat with the driver, and start a call when you need quick coordination.</p></div></div>
    <div className="grid-two tracking-grid">
      <section className="panel"><div className="panel-header"><h3>Order history</h3></div><div className="stack-list">{rows.map((row) => <button key={row.id} className={`stack-item selectable ${selectedOrderId === row.id ? 'selected' : ''}`} onClick={() => setSelectedOrderId(row.id)}><div><strong>{row.restaurant_name}</strong><div className="muted">{formatDate(row.placed_at)} · {row.order_type}</div><div className="muted">Order #{row.id.slice(0, 8)}</div>{row.driver_name ? <div className="muted">Driver: {row.driver_name}{row.vehicle_registration ? ` · ${row.vehicle_registration}` : ''}</div> : null}</div><div><span className={`status-pill ${row.status}`}>{row.status}</span><div className="muted">{currency(row.total_amount)}</div></div></button>)}</div></section>
      <section className="panel communication-panel">
        <div className="panel-header"><h3>Live tracking</h3><span className={`status-pill ${tracking?.order?.status || ''}`}>{tracking?.order?.status || 'No order selected'}</span></div>
        {tracking ? <>
          <div className="mini-stat-row">
            <div className="mini-stat"><span>Instant status</span><strong>{tracking.order.status}</strong></div>
            <div className="mini-stat"><span>ETA</span><strong>{tracking.order.dropoff_eta_mins ? `${tracking.order.dropoff_eta_mins} min` : '—'}</strong></div>
            <div className="mini-stat"><span>Chat updates</span><strong>{tracking.chatSummary.message_count}</strong></div>
          </div>
          <div className="tracking-card">
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
              {tracking.order.driver_image_url ? <img src={resolveAssetUrl(tracking.order.driver_image_url)} alt={tracking.order.driver_name || 'Driver'} style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 18, border: '1px solid rgba(255,255,255,0.12)' }} /> : null}
              <div>
                <strong>{tracking.order.driver_name || 'Driver pending'}</strong>
                <div className="muted">{tracking.order.vehicle_registration || 'Vehicle pending'}</div>
                <div className="muted">{liveLabel}</div>
              </div>
            </div>
            <div className="muted">{tracking.driverLocation ? `Updated ${formatDate(tracking.driverLocation.recorded_at)}` : 'Tracking will begin once a driver accepts the job.'}</div>
            <div className="actions" style={{ flexWrap: 'wrap' }}>
              {tracking.order.driver_phone ? <a className="secondary-btn inline-btn" href={`tel:${tracking.order.driver_phone}`}>Call driver</a> : null}
              {['placed','confirmed','preparing','ready_for_pickup'].includes(tracking.order.status) ? <>
                <input className="text-input" style={{ minWidth: 220 }} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Cancellation reason" />
                <button className="chip-btn danger" onClick={() => void cancelOrder()}>Cancel order</button>
              </> : null}
            </div>
          </div>
          <LiveTrackingMap driverLocation={tracking.driverLocation || null} pickupLocation={tracking.pickupLocation || null} dropoffLocation={tracking.dropoffLocation || null} height={340} />
          <div className="timeline-list">{tracking.orderEvents.map((event, index) => <div className="timeline-item" key={`${event.created_at}-${index}`}><div className="timeline-dot" /><div><strong>{event.status}</strong><div className="muted">{event.notes || 'Status updated'}</div><div className="muted">{formatDate(event.created_at)}</div></div></div>)}</div>
        </> : <div className="muted">Select an order to load live tracking.</div>}
      </section>
    </div>
    <div className="grid-two">
      {token && user && selectedOrderId ? <OrderCommunicationPanel orderId={selectedOrderId} token={token} currentUserId={user.id} roleLabel="Customer line to driver" /> : <section className="panel"><div className="muted">Select an order to open chat and call tools.</div></section>}
      <section className="panel"><div className="panel-header"><h3>Delivery experience</h3></div><div className="feature-list"><div className="feature-item">🛰️ Exact live map route from restaurant to driver to customer pin</div><div className="feature-item">🔔 Instant order status updates from restaurant and driver actions</div><div className="feature-item">⭐ Ready for post-delivery ratings and support follow-up</div></div></section>
    </div>
  </div>;
}
