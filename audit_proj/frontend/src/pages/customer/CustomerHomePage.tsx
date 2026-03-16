
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, currency, resolveAssetUrl } from '../../lib';
import { useAuth } from '../../contexts/AuthContext';

type Restaurant = { id: string; display_name: string; description?: string; cuisine_tags?: string[]; average_rating?: string | number; review_count?: number; city?: string; province?: string; logo_url?: string | null; banner_url?: string | null; active_items?: number };
type HomePayload = { restaurants: Restaurant[]; featuredRestaurants: Array<{ restaurant_id: string; display_name: string; description?: string; average_rating?: string | number; logo_url?: string | null }>; promotions: Array<{ id: string; title: string; description?: string; banner_image_url?: string | null; priority?: number }>; recentOrders: Array<{ id: string; restaurant_name: string; total_amount: number | string; status: string }>; activeCart: { id: string; total_amount: number | string } | null; loyalty: { loyalty_points: number; preferred_language?: string | null } };

export function CustomerHomePage() {
  const { token } = useAuth();
  const [data, setData] = useState<HomePayload | null>(null);
  useEffect(() => { if (!token) return; api<HomePayload>('/customer/home', {}, token).then(setData).catch(console.error); }, [token]);
  return <div className="page-shell">
    <div className="page-header"><div><div className="eyebrow">Discover</div><h1>Discover trending food</h1><p>Browse approved restaurants, specials, and quick delivery favorites near you.</p></div><div className="hero-actions"><Link className="secondary-btn inline-btn" to="/customer/deals">Open deals</Link>{data?.activeCart ? <Link className="primary-btn inline-btn" to="/customer/cart">Open cart · {currency(data.activeCart.total_amount)}</Link> : null}</div></div>
    <div className="mini-stat-row">
      <div className="mini-stat"><span>Loyalty points</span><strong>{data?.loyalty?.loyalty_points ?? 0}</strong></div>
      <div className="mini-stat"><span>Featured stores</span><strong>{data?.featuredRestaurants?.length ?? 0}</strong></div>
      <div className="mini-stat"><span>Live deals</span><strong>{data?.promotions?.length ?? 0}</strong></div>
      <div className="mini-stat"><span>Recent orders</span><strong>{data?.recentOrders?.length ?? 0}</strong></div>
    </div>
    <section className="panel"><div className="panel-header"><h3>Featured near you</h3></div><div className="restaurant-grid">{(data?.featuredRestaurants ?? []).map((row) => <Link key={row.restaurant_id} to={`/customer/restaurants/${row.restaurant_id}`} className="restaurant-hero-tile"><div className="restaurant-logo">{row.logo_url ? <img src={resolveAssetUrl(row.logo_url)} alt={row.display_name} /> : '🍔'}</div><div><strong>{row.display_name}</strong><div className="muted">{row.description || 'Fast delivery, fresh meals, bright storefront branding.'}</div></div><span className="status-pill active">★ {Number(row.average_rating || 0).toFixed(1)}</span></Link>)}</div></section>
    <section className="panel"><div className="panel-header"><h3>Deals for you</h3></div><div className="restaurant-grid">{(data?.promotions ?? []).map((promo) => <div key={promo.id} className="restaurant-hero-tile restaurant-hero-banner" style={promo.banner_image_url ? { backgroundImage: `linear-gradient(180deg, rgba(15,15,18,0.28), rgba(15,15,18,0.82)), url(${resolveAssetUrl(promo.banner_image_url)})` } : undefined}><div className="restaurant-logo">🔥</div><div><strong>{promo.title}</strong><div className="muted">{promo.description || 'Fresh delivery deals available now.'}</div></div><span className="status-pill active">Deal</span></div>)}</div></section>
    <section className="panel"><div className="panel-header"><h3>All restaurants</h3></div><div className="restaurant-grid">{(data?.restaurants ?? []).map((row) => <Link key={row.id} to={`/customer/restaurants/${row.id}`} className="restaurant-hero-tile restaurant-hero-banner" style={row.banner_url ? { backgroundImage: `linear-gradient(180deg, rgba(15,15,18,0.25), rgba(15,15,18,0.78)), url(${resolveAssetUrl(row.banner_url)})` } : undefined}><div className="restaurant-logo">{row.logo_url ? <img src={resolveAssetUrl(row.logo_url)} alt={row.display_name} /> : '🍟'}</div><div><strong>{row.display_name}</strong><div className="muted">{row.city}{row.province ? `, ${row.province}` : ''} · {(row.cuisine_tags || []).join(', ')}</div><div className="muted">{row.description || 'Food crafted for quick delivery and collection.'}</div></div><div><div className="muted">{row.active_items || 0} items</div><span className="status-pill active">★ {Number(row.average_rating || 0).toFixed(1)}</span></div></Link>)}</div></section>
  </div>;
}
