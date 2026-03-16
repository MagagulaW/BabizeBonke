import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, currency, resolveAssetUrl } from '../../lib';
import { useAuth } from '../../contexts/AuthContext';

type Data = {
  restaurant: { id: string; display_name: string; description: string; city: string; province: string; average_rating: string | number; delivery_radius_km: string | number; logo_url?: string | null; banner_url?: string | null };
  categories: { id: string; name: string; description: string }[];
  items: { id: string; category_id: string; name: string; description: string; image_url?: string | null; base_price: string | number; is_vegetarian: boolean; is_vegan: boolean; is_halal: boolean }[];
};

export function CustomerRestaurantPage() {
  const { restaurantId = '' } = useParams();
  const { token } = useAuth();
  const [data, setData] = useState<Data | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !restaurantId) return;
    api<Data>(`/customer/restaurants/${restaurantId}`, {}, token).then(setData).catch(console.error);
  }, [token, restaurantId]);

  const grouped = useMemo(() => {
    if (!data) return [];
    return data.categories.map((category) => ({ ...category, items: data.items.filter((item) => item.category_id === category.id) }));
  }, [data]);

  async function addItem(menuItemId: string) {
    if (!token || !restaurantId) return;
    setBusyId(menuItemId);
    try {
      await api('/customer/cart/items', { method: 'POST', body: JSON.stringify({ restaurantId, menuItemId, quantity: 1 }) }, token);
      alert('Item added to cart');
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to add item');
    } finally {
      setBusyId(null);
    }
  }

  if (!data) return <div className="page-shell">Loading menu...</div>;

  return (
    <div className="page-shell">
      <section className="panel brand-preview-panel">
        <div className="brand-banner vivid-banner" style={data.restaurant.banner_url ? { backgroundImage: `linear-gradient(180deg, rgba(19,8,4,0.15), rgba(19,8,4,0.72)), url(${resolveAssetUrl(data.restaurant.banner_url)})` } : undefined}>
          <div className="brand-avatar large-avatar">{data.restaurant.logo_url ? <img src={resolveAssetUrl(data.restaurant.logo_url)} alt={data.restaurant.display_name} /> : <span>🍽️</span>}</div>
          <div>
            <div className="eyebrow">Customer app</div>
            <h1>{data.restaurant.display_name}</h1>
            <p>{data.restaurant.city}, {data.restaurant.province} · ⭐ {Number(data.restaurant.average_rating).toFixed(1)} · Delivery radius {data.restaurant.delivery_radius_km || '—'} km</p>
          </div>
        </div>
      </section>
      <section className="panel"><p>{data.restaurant.description}</p></section>
      <div className="grid-two">{grouped.map((category) => <section className="panel" key={category.id}><div className="panel-header"><h3>{category.name}</h3></div><div className="stack-list">{category.items.map((item) => <div className="menu-card" key={item.id}><div className="menu-card-media large-media">{item.image_url ? <img src={resolveAssetUrl(item.image_url)} alt={item.name} /> : <span>🍽️</span>}</div><div className="menu-card-body"><strong>{item.name}</strong><div className="muted">{item.description}</div><div className="muted">{item.is_vegetarian ? 'Vegetarian · ' : ''}{item.is_vegan ? 'Vegan · ' : ''}{item.is_halal ? 'Halal' : ''}</div></div><div className="actions"><strong>{currency(item.base_price)}</strong><button className="primary-btn" disabled={busyId === item.id} onClick={() => addItem(item.id)}>{busyId === item.id ? 'Adding...' : 'Add'}</button></div></div>)}</div></section>)}</div>
    </div>
  );
}
