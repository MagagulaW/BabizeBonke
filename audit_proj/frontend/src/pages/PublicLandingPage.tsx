import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, resolveAssetUrl } from '../lib';

type StorefrontData = {
  featuredRestaurants: Array<{ id: string; display_name: string; description?: string; logo_url?: string | null; banner_url?: string | null; average_rating?: string | number; review_count?: number; city?: string; province?: string }>;
  promotions: Array<{ id: string; title: string; description?: string; banner_image_url?: string | null }>;
};

const fallbackSlides = [
  { id: 's1', title: 'Burger Combo', image: null, emoji: '🍔' },
  { id: 's2', title: 'Pizza Special', image: null, emoji: '🍕' },
  { id: 's3', title: 'Chicken Feast', image: null, emoji: '🍗' },
  { id: 's4', title: 'Cold Drinks', image: null, emoji: '🥤' },
  { id: 's5', title: 'Dessert Deals', image: null, emoji: '🍰' },
];

export function PublicLandingPage() {
  const [data, setData] = useState<StorefrontData>({ featuredRestaurants: [], promotions: [] });

  useEffect(() => {
    api<StorefrontData>('/public/storefront').then(setData).catch(() => setData({ featuredRestaurants: [], promotions: [] }));
  }, []);

  return (
    <div className="storefront-page">
      <header className="storefront-nav">
        <div className="storefront-brand"><span className="brand-mark logo-mark storefront-logo"><img src="/jstart-logo.png" alt="JStart Food Delivery" /></span><div><strong>JStart Food Delivery</strong></div></div>
        <nav>
          <a href="#restaurants">Restaurants</a>
          <Link className="secondary-btn inline-btn" to="/customer/deals">Deals</Link>
          <Link className="secondary-btn inline-btn" to="/login">Sign in</Link>
          <Link className="primary-btn inline-btn" to="/register">Get started</Link>
        </nav>
      </header>

      <section className="storefront-hero compact-storefront-hero">
        <div className="storefront-copy">
          <h1>Your next meal, delivered fast.</h1>
          <div className="hero-actions">
            <Link className="primary-btn inline-btn" to="/register">Order now</Link>
            <Link className="secondary-btn inline-btn" to="/login">Sign in</Link>
          </div>
        </div>
        <div className="hero-visual delivery-visual-grid" aria-hidden="true">
          <div className="phone-card map-card">
            <div className="map-dots"></div>
            <div className="route-line"></div>
            <div className="pin restaurant-pin">R</div>
            <div className="pin driver-pin">D</div>
            <div className="pin customer-pin">C</div>
          </div>
          <div className="promo-float burger-card">🍔</div>
          <div className="promo-float pizza-card">🍕</div>
          <div className="promo-float drink-card">🥤</div>
          <div className="delivery-scooter"></div>
        </div>
      </section>

      <section className="promo-slider-section">
        <div className="promo-slider-track">
          {[...(data.promotions.length ? data.promotions.map((promo) => ({ id: promo.id, title: promo.title, image: promo.banner_image_url ?? null, emoji: '🍽️' })) : fallbackSlides), ...(data.promotions.length ? data.promotions.map((promo) => ({ id: `${promo.id}-dup`, title: promo.title, image: promo.banner_image_url ?? null, emoji: '🍽️' })) : fallbackSlides.map((slide) => ({ ...slide, id: `${slide.id}-dup` })))]
            .map((slide) => (
              <article key={slide.id} className="promo-slide-card" style={slide.image ? { backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0.10), rgba(0,0,0,0.66)), url(${resolveAssetUrl(slide.image)})` } : undefined}>
                {!slide.image ? <div className="promo-slide-emoji">{slide.emoji}</div> : null}
                <strong>{slide.title}</strong>
              </article>
            ))}
        </div>
      </section>


      <section className="download-badges-band">
        <div className="download-badge"><span className="store-logo"></span><div><small>Download on the</small><strong>App Store</strong></div></div>
        <div className="download-badge"><span className="store-logo">▶</span><div><small>Get it on</small><strong>Google Play</strong></div></div>
        <div className="download-badge"><span className="store-logo">✦</span><div><small>Explore on</small><strong>AppGallery</strong></div></div>
      </section>

      <section className="landing-section" id="restaurants">
        <div className="section-head"><div><h2>Featured restaurants</h2></div></div>
        <div className="landing-restaurant-grid">
          {data.featuredRestaurants.map((store) => (
            <article className="landing-restaurant-card" key={store.id}>
              <div className="landing-restaurant-banner" style={store.banner_url ? { backgroundImage: `linear-gradient(180deg, rgba(16,16,18,0.15), rgba(16,16,18,0.8)), url(${resolveAssetUrl(store.banner_url)})` } : undefined}></div>
              <div className="landing-restaurant-body">
                <div className="restaurant-logo">{store.logo_url ? <img src={resolveAssetUrl(store.logo_url)} alt={store.display_name} /> : '🍽️'}</div>
                <div>
                  <strong>{store.display_name}</strong>
                  <div className="muted">{store.city}{store.province ? `, ${store.province}` : ''}</div>
                </div>
                <span className="status-pill active">★ {Number(store.average_rating || 4.7).toFixed(1)}</span>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
