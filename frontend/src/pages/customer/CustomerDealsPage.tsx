import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, currency, resolveAssetUrl } from '../../lib';
import { useAuth } from '../../contexts/AuthContext';

type Promotion = { id: string; title: string; description?: string | null; banner_image_url?: string | null; priority?: number | null };
type Coupon = {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  discount_type: 'percent' | 'fixed' | 'free_delivery';
  discount_value: string | number;
  min_order_total: string | number;
  restaurant_id?: string | null;
  restaurant_name?: string | null;
  restaurant_logo_url?: string | null;
  restaurant_banner_url?: string | null;
};
type DealsPayload = { promotions: Promotion[]; coupons: Coupon[]; restaurantSpecials: Coupon[] };

function couponLabel(coupon: Coupon) {
  if (coupon.discount_type === 'free_delivery') return 'Free delivery';
  if (coupon.discount_type === 'percent') return `${Number(coupon.discount_value)}% off`;
  return `${currency(coupon.discount_value)} off`;
}

export function CustomerDealsPage() {
  const { token } = useAuth();
  const [data, setData] = useState<DealsPayload>({ promotions: [], coupons: [], restaurantSpecials: [] });

  useEffect(() => {
    if (!token) return;
    api<DealsPayload>('/customer/deals', {}, token).then(setData).catch(console.error);
  }, [token]);

  return <div className="page-shell">
    <div className="page-header">
      <div>
        <div className="eyebrow">Deals</div>
        <h1>Promos, coupon codes & restaurant specials</h1>
        <p>Unlock the best value across approved restaurants, from platform promos to restaurant-only specials.</p>
      </div>
      <Link to="/customer" className="secondary-btn inline-btn">Back to discover</Link>
    </div>

    <section className="panel">
      <div className="panel-header"><h3>Featured promos</h3></div>
      <div className="restaurant-grid">
        {data.promotions.map((promo) => (
          <article key={promo.id} className="deal-promo-card" style={promo.banner_image_url ? { backgroundImage: `linear-gradient(180deg, rgba(15,15,18,0.18), rgba(15,15,18,0.82)), url(${resolveAssetUrl(promo.banner_image_url)})` } : undefined}>
            <div className="deal-promo-chip">Promo</div>
            <h3>{promo.title}</h3>
            <p>{promo.description || 'Limited-time savings on top dishes and delivery favorites.'}</p>
          </article>
        ))}
      </div>
    </section>

    <section className="panel">
      <div className="panel-header"><h3>Coupon codes</h3></div>
      <div className="coupon-grid">
        {data.coupons.map((coupon) => (
          <article key={coupon.id} className="coupon-card">
            <div className="coupon-code">{coupon.code}</div>
            <strong>{coupon.name}</strong>
            <div className="muted">{coupon.description || 'Use this code at checkout.'}</div>
            <div className="coupon-meta">
              <span className="status-pill active">{couponLabel(coupon)}</span>
              <span className="muted">Min order {currency(coupon.min_order_total)}</span>
            </div>
          </article>
        ))}
      </div>
    </section>

    <section className="panel">
      <div className="panel-header"><h3>Restaurant specials</h3></div>
      <div className="restaurant-grid">
        {data.restaurantSpecials.map((special) => (
          <Link key={special.id} to={special.restaurant_id ? `/customer/restaurants/${special.restaurant_id}` : '/customer'} className="restaurant-hero-tile restaurant-hero-banner special-link" style={special.restaurant_banner_url ? { backgroundImage: `linear-gradient(180deg, rgba(15,15,18,0.22), rgba(15,15,18,0.86)), url(${resolveAssetUrl(special.restaurant_banner_url)})` } : undefined}>
            <div className="restaurant-logo">{special.restaurant_logo_url ? <img src={resolveAssetUrl(special.restaurant_logo_url)} alt={special.restaurant_name || special.name} /> : '🍽️'}</div>
            <div>
              <strong>{special.restaurant_name || 'Restaurant special'}</strong>
              <div className="muted">{special.name}</div>
              <div className="muted">Code: {special.code}</div>
            </div>
            <div>
              <span className="status-pill active">{couponLabel(special)}</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  </div>;
}
