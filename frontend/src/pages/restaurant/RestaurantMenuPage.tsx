import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, currency, resolveAssetUrl, uploadImage } from '../../lib';
import { useAuth } from '../../contexts/AuthContext';

type Category = { id: string; name: string; description: string | null; display_order: number; is_active: boolean };
type Item = { id: string; name: string; description: string | null; image_url: string | null; category_id: string | null; category_name: string | null; base_price: string; sku: string | null; is_available: boolean; is_active: boolean; is_vegetarian: boolean; is_vegan: boolean; is_halal: boolean; display_order: number };
type Profile = {
  restaurant: {
    display_name: string; legal_name: string; trading_name: string | null; description: string | null; support_email: string | null; support_phone: string | null; website_url: string | null;
    cuisine_tags: string[]; prep_time_min_mins: number | null; prep_time_max_mins: number | null; accepts_pickup: boolean; accepts_delivery: boolean;
  } | null;
  location: { location_name?: string | null; address_line1: string; suburb: string | null; city: string; province: string; postal_code: string | null; latitude: number; longitude: number; delivery_radius_km: string | number | null } | null;
  logoUrl: string | null;
  bannerUrl: string | null;
};

const emptyProfile = { displayName: '', legalName: '', tradingName: '', description: '', supportEmail: '', supportPhone: '', websiteUrl: '', cuisineTags: '', prepTimeMinMins: '15', prepTimeMaxMins: '35', acceptsPickup: true, acceptsDelivery: true, logoUrl: '', bannerUrl: '', locationName: 'Main Branch', addressLine1: '', suburb: '', city: '', province: '', postalCode: '', deliveryRadiusKm: '10' };
const emptyItem = { name: '', description: '', imageUrl: '', categoryId: '', basePrice: '0', sku: '', isAvailable: true, isVegetarian: false, isVegan: false, isHalal: false, displayOrder: '0' };

export function RestaurantMenuPage() {
  const { restaurantId = '' } = useParams();
  const { token } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [profile, setProfile] = useState(emptyProfile);
  const [categoryName, setCategoryName] = useState('');
  const [itemForm, setItemForm] = useState(emptyItem);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [uploading, setUploading] = useState('');

  async function load() {
    if (!token) return;
    const [cats, its, prof] = await Promise.all([
      api<Category[]>(`/restaurants/${restaurantId}/categories`, {}, token),
      api<Item[]>(`/restaurants/${restaurantId}/items`, {}, token),
      api<Profile>(`/restaurants/${restaurantId}/profile`, {}, token)
    ]);
    setCategories(cats);
    setItems(its);
    setProfile({
      displayName: prof.restaurant?.display_name || '', legalName: prof.restaurant?.legal_name || '', tradingName: prof.restaurant?.trading_name || '', description: prof.restaurant?.description || '', supportEmail: prof.restaurant?.support_email || '', supportPhone: prof.restaurant?.support_phone || '', websiteUrl: prof.restaurant?.website_url || '', cuisineTags: (prof.restaurant?.cuisine_tags || []).join(', '), prepTimeMinMins: String(prof.restaurant?.prep_time_min_mins ?? 15), prepTimeMaxMins: String(prof.restaurant?.prep_time_max_mins ?? 35), acceptsPickup: Boolean(prof.restaurant?.accepts_pickup), acceptsDelivery: Boolean(prof.restaurant?.accepts_delivery), logoUrl: prof.logoUrl || '', bannerUrl: prof.bannerUrl || '', locationName: prof.location?.location_name || 'Main Branch', addressLine1: prof.location?.address_line1 || '', suburb: prof.location?.suburb || '', city: prof.location?.city || '', province: prof.location?.province || '', postalCode: prof.location?.postal_code || '', deliveryRadiusKm: String(prof.location?.delivery_radius_km ?? 10)
    });
  }

  useEffect(() => { void load(); }, [token, restaurantId]);
  const grouped = useMemo(() => categories.map((category) => ({ category, items: items.filter((item) => item.category_id === category.id) })), [categories, items]);

  async function addCategory(event: React.FormEvent) {
    event.preventDefault();
    if (!token || !categoryName.trim()) return;
    await api(`/restaurants/${restaurantId}/categories`, { method: 'POST', body: JSON.stringify({ name: categoryName, displayOrder: categories.length + 1 }) }, token);
    setCategoryName('');
    await load();
  }

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    if (!token) return;
    await api(`/restaurants/${restaurantId}/profile`, { method: 'PUT', body: JSON.stringify({ displayName: profile.displayName, legalName: profile.legalName, tradingName: profile.tradingName || null, description: profile.description || null, supportEmail: profile.supportEmail || null, supportPhone: profile.supportPhone || null, websiteUrl: profile.websiteUrl || null, cuisineTags: profile.cuisineTags.split(',').map((item) => item.trim()).filter(Boolean), prepTimeMinMins: Number(profile.prepTimeMinMins), prepTimeMaxMins: Number(profile.prepTimeMaxMins), acceptsPickup: profile.acceptsPickup, acceptsDelivery: profile.acceptsDelivery, logoUrl: profile.logoUrl || null, bannerUrl: profile.bannerUrl || null, locationName: profile.locationName || 'Main Branch', addressLine1: profile.addressLine1, suburb: profile.suburb || null, city: profile.city, province: profile.province, postalCode: profile.postalCode || null, deliveryRadiusKm: Number(profile.deliveryRadiusKm) }) }, token);
    alert('Restaurant profile saved');
    await load();
  }

  async function saveItem(event: React.FormEvent) {
    event.preventDefault();
    if (!token) return;
    const body = JSON.stringify({ name: itemForm.name, description: itemForm.description || null, imageUrl: itemForm.imageUrl || null, categoryId: itemForm.categoryId || null, basePrice: Number(itemForm.basePrice), sku: itemForm.sku || null, isAvailable: itemForm.isAvailable, isVegetarian: itemForm.isVegetarian, isVegan: itemForm.isVegan, isHalal: itemForm.isHalal, isActive: true, displayOrder: Number(itemForm.displayOrder || 0) });
    if (editingItemId) await api(`/restaurants/${restaurantId}/items/${editingItemId}`, { method: 'PUT', body }, token);
    else await api(`/restaurants/${restaurantId}/items`, { method: 'POST', body }, token);
    setItemForm(emptyItem);
    setEditingItemId(null);
    await load();
  }

  function editItem(item: Item) {
    setEditingItemId(item.id);
    setItemForm({ name: item.name, description: item.description || '', imageUrl: item.image_url || '', categoryId: item.category_id || '', basePrice: String(item.base_price), sku: item.sku || '', isAvailable: item.is_available, isVegetarian: item.is_vegetarian, isVegan: item.is_vegan, isHalal: item.is_halal, displayOrder: String(item.display_order || 0) });
  }

  async function handleUpload(target: 'logo' | 'banner' | 'dish', file?: File | null) {
    if (!file || !token) return;
    setUploading(target);
    try {
      const result = await uploadImage(file, token);
      if (target === 'logo') setProfile((s) => ({ ...s, logoUrl: result.url }));
      if (target === 'banner') setProfile((s) => ({ ...s, bannerUrl: result.url }));
      if (target === 'dish') setItemForm((s) => ({ ...s, imageUrl: result.url }));
    } finally {
      setUploading('');
    }
  }

  async function removeCategory(id: string) { if (!token) return; await api(`/restaurants/${restaurantId}/categories/${id}`, { method: 'DELETE' }, token); await load(); }
  async function removeItem(id: string) { if (!token) return; await api(`/restaurants/${restaurantId}/items/${id}`, { method: 'DELETE' }, token); await load(); }

  return <div className="page-shell">
    <div className="page-header"><div><div className="eyebrow">Restaurant workspace</div><h1>Branding & menu studio</h1><p>Upload your logo, banner, and dish images directly into the real system. Every visual now feeds the live customer storefront.</p></div></div>
    <section className="panel brand-preview-panel">
      <div className="brand-banner vivid-banner" style={profile.bannerUrl ? { backgroundImage: `linear-gradient(135deg, rgba(51,18,5,.35), rgba(18,10,5,.55)), url(${profile.bannerUrl})` } : undefined}>
        <div className="brand-avatar large-avatar">{profile.logoUrl ? <img src={resolveAssetUrl(profile.logoUrl)} alt="Restaurant logo" /> : <span>{(profile.displayName || 'FD').slice(0, 2).toUpperCase()}</span>}</div>
        <div><h2>{profile.displayName || 'Your Restaurant Name'}</h2><p>{profile.cuisineTags || 'Add cuisine tags to improve search and discovery'}</p></div>
      </div>
    </section>
    <div className="grid-two">
      <form className="panel form-panel" onSubmit={saveProfile}>
        <div className="panel-header"><h3>Restaurant profile</h3></div>
        <div className="upload-grid two-up">
          <div className="upload-card"><label>Logo upload</label><input type="file" accept="image/*" onChange={(e) => void handleUpload('logo', e.target.files?.[0])} />{uploading === 'logo' ? <div className="muted">Uploading…</div> : null}{profile.logoUrl ? <img className="upload-preview" src={profile.logoUrl} alt="Logo" /> : null}</div>
          <div className="upload-card"><label>Banner upload</label><input type="file" accept="image/*" onChange={(e) => void handleUpload('banner', e.target.files?.[0])} />{uploading === 'banner' ? <div className="muted">Uploading…</div> : null}{profile.bannerUrl ? <img className="upload-preview wide" src={profile.bannerUrl} alt="Banner" /> : null}</div>
        </div>
        <div className="form-grid-2">
          <div><label>Display name</label><input value={profile.displayName} onChange={(e) => setProfile((s) => ({ ...s, displayName: e.target.value }))} /></div>
          <div><label>Legal name</label><input value={profile.legalName} onChange={(e) => setProfile((s) => ({ ...s, legalName: e.target.value }))} /></div>
          <div><label>Support email</label><input value={profile.supportEmail} onChange={(e) => setProfile((s) => ({ ...s, supportEmail: e.target.value }))} /></div>
          <div><label>Support phone</label><input value={profile.supportPhone} onChange={(e) => setProfile((s) => ({ ...s, supportPhone: e.target.value }))} /></div>
          <div><label>Website URL</label><input value={profile.websiteUrl} onChange={(e) => setProfile((s) => ({ ...s, websiteUrl: e.target.value }))} /></div>
          <div><label>Cuisine tags</label><input value={profile.cuisineTags} onChange={(e) => setProfile((s) => ({ ...s, cuisineTags: e.target.value }))} placeholder="burgers, pizza, kota" /></div>
          <div><label>Prep min (mins)</label><input type="number" value={profile.prepTimeMinMins} onChange={(e) => setProfile((s) => ({ ...s, prepTimeMinMins: e.target.value }))} /></div>
          <div><label>Prep max (mins)</label><input type="number" value={profile.prepTimeMaxMins} onChange={(e) => setProfile((s) => ({ ...s, prepTimeMaxMins: e.target.value }))} /></div>
          <div className="full-span"><label>Description</label><textarea value={profile.description} onChange={(e) => setProfile((s) => ({ ...s, description: e.target.value }))} /></div>
        </div>
        <div className="checkbox-group">
          <label className="checkbox-row"><input type="checkbox" checked={profile.acceptsPickup} onChange={(e) => setProfile((s) => ({ ...s, acceptsPickup: e.target.checked }))} /><span>Accept pickup orders</span></label>
          <label className="checkbox-row"><input type="checkbox" checked={profile.acceptsDelivery} onChange={(e) => setProfile((s) => ({ ...s, acceptsDelivery: e.target.checked }))} /><span>Accept delivery orders</span></label>
        </div>
        <div className="panel-header"><h3>Primary location</h3></div>
        <div className="form-grid-2">
          <div className="full-span"><label>Address line 1</label><input value={profile.addressLine1} onChange={(e) => setProfile((s) => ({ ...s, addressLine1: e.target.value }))} /></div>
          <div><label>Suburb</label><input value={profile.suburb} onChange={(e) => setProfile((s) => ({ ...s, suburb: e.target.value }))} /></div>
          <div><label>City</label><input value={profile.city} onChange={(e) => setProfile((s) => ({ ...s, city: e.target.value }))} /></div>
          <div><label>Province</label><input value={profile.province} onChange={(e) => setProfile((s) => ({ ...s, province: e.target.value }))} /></div>
          <div><label>Postal code</label><input value={profile.postalCode} onChange={(e) => setProfile((s) => ({ ...s, postalCode: e.target.value }))} /></div>
          <div><label>Delivery radius (km)</label><input value={profile.deliveryRadiusKm} onChange={(e) => setProfile((s) => ({ ...s, deliveryRadiusKm: e.target.value }))} /></div>
          <div><label>Location name</label><input value={profile.locationName} onChange={(e) => setProfile((s) => ({ ...s, locationName: e.target.value }))} /></div>
        </div>
        <button className="primary-btn">Save restaurant profile</button>
      </form>
      <div className="page-shell">
        <form className="panel form-panel" onSubmit={addCategory}><div className="panel-header"><h3>Add category</h3></div><label>Name</label><input value={categoryName} onChange={(e) => setCategoryName(e.target.value)} placeholder="Burgers" /><button className="primary-btn">Create category</button></form>
        <form className="panel form-panel" onSubmit={saveItem}>
          <div className="panel-header"><h3>{editingItemId ? 'Edit menu item' : 'Add menu item'}</h3></div>
          <div className="upload-card compact"><label>Dish image upload</label><input type="file" accept="image/*" onChange={(e) => void handleUpload('dish', e.target.files?.[0])} />{uploading === 'dish' ? <div className="muted">Uploading…</div> : null}{itemForm.imageUrl ? <img className="upload-preview wide" src={itemForm.imageUrl} alt="Dish" /> : null}</div>
          <label>Name</label><input value={itemForm.name} onChange={(e) => setItemForm((s) => ({ ...s, name: e.target.value }))} placeholder="Cheese Burger" />
          <label>Description</label><textarea value={itemForm.description} onChange={(e) => setItemForm((s) => ({ ...s, description: e.target.value }))} />
          <label>Category</label><select value={itemForm.categoryId} onChange={(e) => setItemForm((s) => ({ ...s, categoryId: e.target.value }))}><option value="">No category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
          <div className="form-grid-2 compact-grid"><div><label>Base price</label><input type="number" step="0.01" value={itemForm.basePrice} onChange={(e) => setItemForm((s) => ({ ...s, basePrice: e.target.value }))} /></div><div><label>SKU</label><input value={itemForm.sku} onChange={(e) => setItemForm((s) => ({ ...s, sku: e.target.value }))} /></div><div><label>Display order</label><input type="number" value={itemForm.displayOrder} onChange={(e) => setItemForm((s) => ({ ...s, displayOrder: e.target.value }))} /></div></div>
          <div className="checkbox-group"><label className="checkbox-row"><input type="checkbox" checked={itemForm.isAvailable} onChange={(e) => setItemForm((s) => ({ ...s, isAvailable: e.target.checked }))} /><span>Available</span></label><label className="checkbox-row"><input type="checkbox" checked={itemForm.isVegetarian} onChange={(e) => setItemForm((s) => ({ ...s, isVegetarian: e.target.checked }))} /><span>Vegetarian</span></label><label className="checkbox-row"><input type="checkbox" checked={itemForm.isVegan} onChange={(e) => setItemForm((s) => ({ ...s, isVegan: e.target.checked }))} /><span>Vegan</span></label><label className="checkbox-row"><input type="checkbox" checked={itemForm.isHalal} onChange={(e) => setItemForm((s) => ({ ...s, isHalal: e.target.checked }))} /><span>Halal</span></label></div>
          <div className="actions"><button className="primary-btn">{editingItemId ? 'Save changes' : 'Add item'}</button>{editingItemId ? <button type="button" className="secondary-btn" onClick={() => { setEditingItemId(null); setItemForm(emptyItem); }}>Cancel edit</button> : null}</div>
        </form>
      </div>
    </div>
    <div className="grid-two">
      <section className="panel"><div className="panel-header"><h3>Categories</h3></div><div className="stack-list">{categories.map((category) => <div className="stack-item" key={category.id}><div><strong>{category.name}</strong><div className="muted">Order #{category.display_order}</div></div><button className="chip-btn warning" onClick={() => removeCategory(category.id)}>Delete</button></div>)}</div></section>
      <section className="panel"><div className="panel-header"><h3>Items by category</h3></div><div className="stack-list">{grouped.map(({ category, items: categoryItems }) => <div key={category.id} className="category-block"><div className="category-title">{category.name}</div>{categoryItems.length ? categoryItems.map((item) => <div className="menu-card" key={item.id}><div className="menu-card-media large-media">{item.image_url ? <img src={resolveAssetUrl(item.image_url)} alt={item.name} /> : <span>🍽️</span>}</div><div className="menu-card-body"><strong>{item.name}</strong><div className="muted">{item.description || 'No description yet'}</div><div className="muted">{currency(item.base_price)} · {item.sku || 'No SKU'} · {item.is_available ? 'Available' : 'Hidden'}</div></div><div className="actions"><button className="chip-btn" onClick={() => editItem(item)}>Edit</button><button className="chip-btn warning" onClick={() => removeItem(item.id)}>Delete</button></div></div>) : <div className="muted">No items yet.</div>}</div>)}</div></section>
    </div>
  </div>;
}
