import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, currency, resolveAssetUrl } from '../../lib';
import { useAuth } from '../../contexts/AuthContext';

type Restaurant = { id: string; display_name: string; description?: string; cuisine_tags?: string[]; average_rating?: string | number; review_count?: number; city?: string; province?: string; logo_url?: string | null; banner_url?: string | null; active_items?: number };
type HomePayload = { restaurants: Restaurant[]; featuredRestaurants: Array<{ restaurant_id: string; display_name: string; description?: string; average_rating?: string | number; logo_url?: string | null; banner_url?: string | null; cuisine_tags?: string[]; active_items?: number; city?: string; province?: string }>; promotions: Array<{ id: string; title: string; description?: string; banner_image_url?: string | null; priority?: number }>; recentOrders: Array<{ id: string; restaurant_name: string; total_amount: number | string; status: string }>; activeCart: { id: string; total_amount: number | string } | null; loyalty: { loyalty_points: number; preferred_language?: string | null } };

export function CustomerHomePage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<HomePayload | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCuisine, setActiveCuisine] = useState('All');
  useEffect(() => { if (!token) return; api<HomePayload>('/customer/home', {}, token).then(setData).catch(console.error); }, [token]);

  const restaurants = useMemo(() => {
    const featured: Restaurant[] = (data?.featuredRestaurants ?? []).map((item) => ({
      id: item.restaurant_id,
      display_name: item.display_name,
      description: item.description,
      average_rating: item.average_rating,
      logo_url: item.logo_url,
      banner_url: item.banner_url,
      cuisine_tags: item.cuisine_tags ?? [],
      active_items: item.active_items ?? 0,
      city: item.city,
      province: item.province,
    }));
    const regular = data?.restaurants ?? [];
    const merged = [...featured, ...regular];
    const seen = new Set<string>();
    return merged.filter((item) => {
      const id = item.id || (item as { restaurant_id?: string }).restaurant_id;
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }, [data]);

  const cuisineTags = useMemo(() => {
    const tags: string[] = [];
    restaurants.forEach((item) => (item.cuisine_tags ?? []).forEach((tag: string) => {
      if (tag && !tags.includes(tag)) tags.push(tag);
    }));
    return ['All', ...tags.slice(0, 8)];
  }, [restaurants]);

  const filteredRestaurants = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return restaurants.filter((item) => {
      const cuisineMatch = activeCuisine === 'All' || (item.cuisine_tags ?? []).some((tag) => tag.toLowerCase() === activeCuisine.toLowerCase());
      if (!cuisineMatch) return false;
      if (!query) return true;
      const haystack = [item.display_name, item.description, item.city, item.province, ...(item.cuisine_tags ?? [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [restaurants, searchQuery, activeCuisine]);

  const featuredStores = useMemo(() => filteredRestaurants.slice(0, 8), [filteredRestaurants]);

  const sliderItems = useMemo(() => {
    const promos = data?.promotions ?? [];
    const baseRestaurants = featuredStores.length ? featuredStores : filteredRestaurants.length ? filteredRestaurants : restaurants;
    const promoSlides = promos.map((promo, index) => {
      const linkedRestaurant = baseRestaurants[index % Math.max(baseRestaurants.length, 1)] || null;
      return {
        key: `promo-${promo.id}`,
        kind: 'promotion' as const,
        title: promo.title || 'Limited time deal',
        subtitle: promo.description || 'Tap to open the linked restaurant menu.',
        imageUrl: resolveAssetUrl(promo.banner_image_url || linkedRestaurant?.banner_url || linkedRestaurant?.logo_url),
        restaurantId: linkedRestaurant?.id || null,
        restaurantName: linkedRestaurant?.display_name || 'Featured restaurant',
      };
    });
    const restaurantSlides = featuredStores.map((item) => ({
      key: `restaurant-${item.id}`,
      kind: 'restaurant' as const,
      title: item.display_name,
      subtitle: item.description || 'Browse the menu and order fast.',
      imageUrl: resolveAssetUrl(item.banner_url || item.logo_url),
      restaurantId: item.id,
      restaurantName: item.display_name,
    }));
    return [...promoSlides, ...restaurantSlides].filter((item) => item.restaurantId);
  }, [data, featuredStores, filteredRestaurants, restaurants]);

  return <div className="page-shell customer-home-shell customer-discover-upgrade">
    <section className="customer-hero-panel customer-hero-upgraded">
      <div className="customer-hero-copy">
        <div className="eyebrow">Customer app</div>
        <h1>Discover food fast</h1>
        <p>Browse featured stores, swipe promos, and jump straight into restaurant menus with a cleaner marketplace layout inspired by modern delivery apps while keeping your current colours.</p>
        <div className="hero-actions">
          <Link className="secondary-btn inline-btn" to="/customer/deals">Open deals</Link>
          {data?.activeCart ? <Link className="primary-btn inline-btn" to="/customer/cart">Open cart · {currency(data.activeCart.total_amount)}</Link> : null}
        </div>
      </div>
      <div className="customer-hero-search-panel">
        <div className="customer-search-bar">
          <span>🔎</span>
          <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search restaurants, burgers, pizza, chicken..." aria-label="Search restaurants" />
          {searchQuery ? <button type="button" className="customer-search-clear" onClick={() => setSearchQuery('')}>✕</button> : <span>⚙️</span>}
        </div>
        <div className="customer-chip-row">
          {cuisineTags.map((tag) => <button type="button" key={tag} className={`customer-chip ${tag === activeCuisine ? 'active' : ''}`} onClick={() => setActiveCuisine(tag)}>{tag}</button>)}
        </div>
      </div>
    </section>

    <section className="panel customer-slider-panel">
      <div className="panel-header"><h3>Top promos & restaurants</h3><span className="muted">Click any slide</span></div>
      <div className="customer-slider-strip">
        {sliderItems.map((slide) => (
          <button key={slide.key} type="button" className="customer-slider-card" onClick={() => navigate(`/customer/restaurants/${slide.restaurantId}`)} style={slide.imageUrl ? { backgroundImage: `linear-gradient(180deg, rgba(15,15,18,0.14), rgba(15,15,18,0.78)), url(${slide.imageUrl})` } : undefined}>
            <div className="customer-slider-topline">
              <span className={`status-pill ${slide.kind === 'promotion' ? 'active' : ''}`}>{slide.kind === 'promotion' ? 'Promo' : 'Featured'}</span>
              <span className="slider-arrow">→</span>
            </div>
            <div className="customer-slider-copy">
              <strong>{slide.title}</strong>
              <p>{slide.subtitle}</p>
              <small>{slide.restaurantName}</small>
            </div>
          </button>
        ))}
      </div>
    </section>

    <section className="panel">
      <div className="panel-header"><h3>Featured near you</h3></div>
      <div className="customer-card-grid featured-scroll-grid">
        {featuredStores.map((row) => (
          <Link key={row.id} to={`/customer/restaurants/${row.id}`} className="customer-store-card compact-card upgraded-store-card" style={row.banner_url ? { backgroundImage: `linear-gradient(180deg, rgba(15,15,18,0.18), rgba(15,15,18,0.84)), url(${resolveAssetUrl(row.banner_url)})` } : undefined}>
            <div className="customer-store-topline"><span className="status-pill active">★ {Number(row.average_rating || 0).toFixed(1)}</span></div>
            <div className="customer-store-body">
              <div className="restaurant-logo">{row.logo_url ? <img src={resolveAssetUrl(row.logo_url)} alt={row.display_name} /> : '🍔'}</div>
              <div className="customer-store-copy"><strong>{row.display_name}</strong><p>{row.description || 'Fast delivery, fresh meals, bright storefront branding.'}</p></div>
            </div>
          </Link>
        ))}
      </div>
    </section>

    <section className="panel">
      <div className="panel-header"><h3>Deals for you</h3></div>
      <div className="customer-card-grid customer-card-grid-promos">
        {(data?.promotions ?? []).map((promo, index) => {
          const linkedRestaurant = featuredStores[index % Math.max(featuredStores.length, 1)] || restaurants[index % Math.max(restaurants.length, 1)] || null;
          return (
            <button key={promo.id} type="button" className="customer-store-card promo-card promo-click-card" onClick={() => linkedRestaurant ? navigate(`/customer/restaurants/${linkedRestaurant.id}`) : undefined} style={promo.banner_image_url ? { backgroundImage: `linear-gradient(180deg, rgba(15,15,18,0.20), rgba(15,15,18,0.84)), url(${resolveAssetUrl(promo.banner_image_url)})` } : undefined}>
              <div className="customer-store-topline"><span className="status-pill active">Deal</span></div>
              <div className="customer-store-copy"><strong>{promo.title}</strong><p>{promo.description || 'Fresh delivery deals available now.'}</p>{linkedRestaurant ? <small>Open {linkedRestaurant.display_name}</small> : null}</div>
            </button>
          );
        })}
      </div>
    </section>

    <section className="panel">
      <div className="panel-header"><h3>All restaurants</h3></div>
      <div className="customer-card-grid">
        {!filteredRestaurants.length ? <div className="empty-inline-state">No restaurants matched your search or selected filter.</div> : filteredRestaurants.map((row) => (
          <Link key={row.id} to={`/customer/restaurants/${row.id}`} className="customer-store-card upgraded-store-card" style={row.banner_url ? { backgroundImage: `linear-gradient(180deg, rgba(15,15,18,0.18), rgba(15,15,18,0.86)), url(${resolveAssetUrl(row.banner_url)})` } : undefined}>
            <div className="customer-store-topline">
              <span className="status-pill active">★ {Number(row.average_rating || 0).toFixed(1)}</span>
              <span className="muted">{row.active_items || 0} items</span>
            </div>
            <div className="customer-store-body">
              <div className="restaurant-logo">{row.logo_url ? <img src={resolveAssetUrl(row.logo_url)} alt={row.display_name} /> : '🍟'}</div>
              <div className="customer-store-copy">
                <strong>{row.display_name}</strong>
                <p>{[row.city, row.province].filter(Boolean).join(', ')}{row.cuisine_tags?.length ? ` · ${row.cuisine_tags.join(', ')}` : ''}</p>
                <p>{row.description || 'Food crafted for quick delivery and collection.'}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  </div>;
}
