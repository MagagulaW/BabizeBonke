import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, uploadImage } from '../lib';
import type { Session } from '../types';

const STORAGE_KEY = 'food-delivery-v2-session';
type Mode = 'customer' | 'driver' | 'restaurant';

type PendingResponse = { pendingApproval: boolean; message: string };

function isStrongPassword(value: string) {
  return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,64}$/.test(value);
}
function isInternationalPhone(value: string) {
  return /^\+[1-9]\d{7,14}$/.test(value.trim());
}
function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function RegisterPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('customer');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState('');
  const [uploading, setUploading] = useState('');
  const [common, setCommon] = useState({ fullName: '', email: '', phone: '', password: '' });
  const [customer, setCustomer] = useState({ preferredLanguage: 'en', marketingOptIn: true });
  const [driver, setDriver] = useState({ licenseNumber: '', licenseExpiryDate: '', emergencyContactName: '', emergencyContactPhone: '', nationalIdNumber: '', profileImageUrl: '', vehicleType: 'motorbike', vehicleMake: '', vehicleModel: '', vehicleYear: '', vehicleColor: '', registrationNumber: '' });
  const [restaurant, setRestaurant] = useState({ ownerFullName: '', legalName: '', displayName: '', tradingName: '', description: '', supportEmail: '', supportPhone: '', websiteUrl: '', taxNumber: '', registrationNumber: '', cuisineTags: '', prepTimeMinMins: '', prepTimeMaxMins: '', acceptsPickup: true, acceptsDelivery: true, locationName: 'Main Branch', addressLine1: '', addressLine2: '', suburb: '', city: '', province: '', postalCode: '', deliveryRadiusKm: '10', logoUrl: '', bannerUrl: '' });

  const title = useMemo(() => ({ customer: 'Create account', driver: 'Driver application', restaurant: 'Restaurant application' }[mode]), [mode]);

  async function handleUpload(kind: 'driver' | 'logo' | 'banner', file?: File | null) {
    if (!file) return;
    setUploading(kind); setError('');
    try {
      const result = await uploadImage(file, undefined, true);
      if (kind === 'driver') setDriver((s) => ({ ...s, profileImageUrl: result.url }));
      if (kind === 'logo') setRestaurant((s) => ({ ...s, logoUrl: result.url }));
      if (kind === 'banner') setRestaurant((s) => ({ ...s, bannerUrl: result.url }));
    } catch (err) { setError(err instanceof Error ? err.message : 'Upload failed'); }
    finally { setUploading(''); }
  }

  function validateBeforeSubmit() {
    if (!common.fullName.trim() && mode !== 'restaurant') return { key: 'fullName', message: 'Full name is required' };
    if (!common.email.trim()) return { key: 'email', message: 'Email is required' };
    if (!isValidEmail(common.email)) return { key: 'email', message: 'Enter a valid email address' };
    if (!isInternationalPhone(common.phone)) return { key: 'phone', message: 'Phone number must include a country code, for example +27821234567' };
    if (!isStrongPassword(common.password)) return { key: 'password', message: 'Password must be 8+ characters and include uppercase, lowercase, number, and symbol' };
    if (mode === 'driver') {
      if (!driver.licenseNumber.trim()) return { key: 'licenseNumber', message: 'License number is required' };
      if (!driver.registrationNumber.trim()) return { key: 'registrationNumber', message: 'Vehicle registration number is required' };
      if (!isInternationalPhone(driver.emergencyContactPhone)) return { key: 'emergencyContactPhone', message: 'Emergency contact phone must include a country code' };
    }
    if (mode === 'restaurant') {
      if (!(restaurant.ownerFullName || common.fullName).trim()) return { key: 'ownerFullName', message: 'Owner full name is required' };
      if (restaurant.supportPhone && !isInternationalPhone(restaurant.supportPhone)) return { key: 'supportPhone', message: 'Support phone must include a country code' };
      if (!restaurant.legalName.trim()) return { key: 'legalName', message: 'Legal name is required' };
      if (!restaurant.displayName.trim()) return { key: 'displayName', message: 'Display name is required' };
      if (!restaurant.addressLine1.trim()) return { key: 'addressLine1', message: 'Address line 1 is required' };
      if (!restaurant.city.trim()) return { key: 'city', message: 'City is required' };
      if (!restaurant.province.trim()) return { key: 'province', message: 'Province is required' };
    }
    return null;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true); setError(''); setFieldErrors({}); setSuccess('');
    const validationError = validateBeforeSubmit();
    if (validationError) { setLoading(false); setFieldErrors({ [validationError.key]: validationError.message }); setError(validationError.message); return; }
    try {
      if (mode === 'customer') {
        const session = await api<Session>('/auth/register/customer', { method: 'POST', body: JSON.stringify({ ...common, preferredLanguage: customer.preferredLanguage, marketingOptIn: customer.marketingOptIn }) });
        localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
        window.location.href = '/app';
        return;
      }
      if (mode === 'driver') {
        const response = await api<PendingResponse>('/auth/register/driver', { method: 'POST', body: JSON.stringify({ ...common, ...driver, vehicleYear: driver.vehicleYear ? Number(driver.vehicleYear) : null }) });
        setSuccess(response.message); setTimeout(() => navigate('/login'), 1200); return;
      }
      const response = await api<PendingResponse>('/auth/register/restaurant', {
        method: 'POST',
        body: JSON.stringify({
          ownerFullName: restaurant.ownerFullName || common.fullName,
          email: common.email,
          phone: common.phone,
          password: common.password,
          legalName: restaurant.legalName,
          displayName: restaurant.displayName,
          tradingName: restaurant.tradingName || null,
          description: restaurant.description || null,
          supportEmail: restaurant.supportEmail || common.email,
          supportPhone: restaurant.supportPhone || common.phone,
          websiteUrl: restaurant.websiteUrl || null,
          taxNumber: restaurant.taxNumber || null,
          registrationNumber: restaurant.registrationNumber || null,
          cuisineTags: restaurant.cuisineTags.split(',').map((item) => item.trim()).filter(Boolean),
          prepTimeMinMins: restaurant.prepTimeMinMins ? Number(restaurant.prepTimeMinMins) : null,
          prepTimeMaxMins: restaurant.prepTimeMaxMins ? Number(restaurant.prepTimeMaxMins) : null,
          acceptsPickup: restaurant.acceptsPickup,
          acceptsDelivery: restaurant.acceptsDelivery,
          addressLine1: restaurant.addressLine1,
          addressLine2: restaurant.addressLine2 || null,
          suburb: restaurant.suburb || null,
          city: restaurant.city,
          province: restaurant.province,
          postalCode: restaurant.postalCode || null,
          locationName: restaurant.locationName || 'Main Branch',
          latitude: null,
          longitude: null,
          deliveryRadiusKm: Number(restaurant.deliveryRadiusKm),
          logoUrl: restaurant.logoUrl || null,
          bannerUrl: restaurant.bannerUrl || null
        })
      });
      setSuccess(response.message); setTimeout(() => navigate('/login'), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed. Check the highlighted details and try again.');
    } finally { setLoading(false); }
  }

  return (
    <div className="login-shell warm-shell bright-shell">
      <div className="login-panel login-panel-info hero-card food-hero">
        <div className="delivery-animation" aria-hidden="true">
          <div className="sun-glow"></div><div className="city-line"></div><div className="food-bag"></div>
          <div className="scooter scooter-a"><span className="wheel left"></span><span className="wheel right"></span><span className="rider"></span></div>
          <div className="scooter scooter-b"><span className="wheel left"></span><span className="wheel right"></span><span className="rider"></span></div>
          <div className="pulse pulse-one"></div><div className="pulse pulse-two"></div>
        </div>
        <div className="mode-switch compact-mode-switch">
          <button type="button" className={`tab-btn ${mode === 'customer' ? 'active' : ''}`} onClick={() => setMode('customer')}>Customer</button>
          <button type="button" className={`tab-btn ${mode === 'driver' ? 'active' : ''}`} onClick={() => setMode('driver')}>Driver</button>
          <button type="button" className={`tab-btn ${mode === 'restaurant' ? 'active' : ''}`} onClick={() => setMode('restaurant')}>Restaurant</button>
        </div>
      </div>
      <form className="login-panel register-panel" onSubmit={submit}>
        <h2>{title}</h2>
        {error ? <div className="error-box">{error}</div> : null}
        {success ? <div className="success-box">{success}</div> : null}
        <div className="form-grid-2">
          <div><label>{mode === 'restaurant' ? 'Owner full name' : 'Full name'}</label><input value={mode === 'restaurant' ? restaurant.ownerFullName || common.fullName : common.fullName} onChange={(e) => mode === 'restaurant' ? setRestaurant((s) => ({ ...s, ownerFullName: e.target.value })) : setCommon((s) => ({ ...s, fullName: e.target.value }))} /></div>
          <div><label>Email</label><input type="email" value={common.email} onChange={(e) => setCommon((s) => ({ ...s, email: e.target.value }))} autoComplete="email" />{fieldErrors.email ? <small className="field-error">{fieldErrors.email}</small> : null}</div>
          <div><label>Phone</label><input value={common.phone} onChange={(e) => setCommon((s) => ({ ...s, phone: e.target.value }))} placeholder="+27821234567" />{fieldErrors.phone ? <small className="field-error">{fieldErrors.phone}</small> : null}</div>
          <div><label>Password</label><input type="password" value={common.password} onChange={(e) => setCommon((s) => ({ ...s, password: e.target.value }))} placeholder="Strong password" autoComplete="new-password" />{fieldErrors.password ? <small className="field-error">{fieldErrors.password}</small> : null}</div>
        </div>
        {mode === 'customer' && <div className="form-grid-2"><div><label>Preferred language</label><input value={customer.preferredLanguage} onChange={(e) => setCustomer((s) => ({ ...s, preferredLanguage: e.target.value }))} /></div><div className="checkbox-row"><input type="checkbox" checked={customer.marketingOptIn} onChange={(e) => setCustomer((s) => ({ ...s, marketingOptIn: e.target.checked }))} /><span>Receive promotions and alerts</span></div></div>}
        {mode === 'driver' && <><div className="upload-grid"><div className="upload-card"><label>Driver photo</label><input type="file" accept="image/*" onChange={(e) => void handleUpload('driver', e.target.files?.[0])} />{uploading === 'driver' ? <div className="muted">Uploading image…</div> : null}{driver.profileImageUrl ? <img className="upload-preview" src={driver.profileImageUrl} alt="Driver profile" /> : null}</div></div><div className="form-grid-2"><div><label>License number</label><input value={driver.licenseNumber} onChange={(e) => setDriver((s) => ({ ...s, licenseNumber: e.target.value }))} /></div><div><label>License expiry date</label><input type="date" value={driver.licenseExpiryDate} onChange={(e) => setDriver((s) => ({ ...s, licenseExpiryDate: e.target.value }))} /></div><div><label>National ID number</label><input value={driver.nationalIdNumber} onChange={(e) => setDriver((s) => ({ ...s, nationalIdNumber: e.target.value }))} /></div><div><label>Emergency contact name</label><input value={driver.emergencyContactName} onChange={(e) => setDriver((s) => ({ ...s, emergencyContactName: e.target.value }))} /></div><div><label>Emergency contact phone</label><input value={driver.emergencyContactPhone} onChange={(e) => setDriver((s) => ({ ...s, emergencyContactPhone: e.target.value }))} placeholder="+27821234567" /></div><div><label>Vehicle type</label><select value={driver.vehicleType} onChange={(e) => setDriver((s) => ({ ...s, vehicleType: e.target.value }))}><option value="bike">Bike</option><option value="motorbike">Motorbike</option><option value="car">Car</option><option value="van">Van</option><option value="other">Other</option></select></div><div><label>Vehicle make</label><input value={driver.vehicleMake} onChange={(e) => setDriver((s) => ({ ...s, vehicleMake: e.target.value }))} /></div><div><label>Vehicle model</label><input value={driver.vehicleModel} onChange={(e) => setDriver((s) => ({ ...s, vehicleModel: e.target.value }))} /></div><div><label>Vehicle year</label><input value={driver.vehicleYear} onChange={(e) => setDriver((s) => ({ ...s, vehicleYear: e.target.value }))} /></div><div><label>Vehicle color</label><input value={driver.vehicleColor} onChange={(e) => setDriver((s) => ({ ...s, vehicleColor: e.target.value }))} /></div><div className="full-span"><label>Vehicle registration number</label><input value={driver.registrationNumber} onChange={(e) => setDriver((s) => ({ ...s, registrationNumber: e.target.value }))} /></div></div></>}
        {mode === 'restaurant' && <><div className="panel-lite"><div className="upload-grid two-up"><div className="upload-card"><label>Restaurant logo</label><input type="file" accept="image/*" onChange={(e) => void handleUpload('logo', e.target.files?.[0])} />{restaurant.logoUrl ? <img className="upload-preview" src={restaurant.logoUrl} alt="Restaurant logo" /> : null}</div><div className="upload-card"><label>Restaurant banner</label><input type="file" accept="image/*" onChange={(e) => void handleUpload('banner', e.target.files?.[0])} />{restaurant.bannerUrl ? <img className="upload-preview wide" src={restaurant.bannerUrl} alt="Restaurant banner" /> : null}</div></div><div className="form-grid-2"><div><label>Legal name</label><input value={restaurant.legalName} onChange={(e) => setRestaurant((s) => ({ ...s, legalName: e.target.value }))} /></div><div><label>Display name</label><input value={restaurant.displayName} onChange={(e) => setRestaurant((s) => ({ ...s, displayName: e.target.value }))} /></div><div><label>Trading name</label><input value={restaurant.tradingName} onChange={(e) => setRestaurant((s) => ({ ...s, tradingName: e.target.value }))} /></div><div><label>Support email</label><input type="email" value={restaurant.supportEmail} onChange={(e) => setRestaurant((s) => ({ ...s, supportEmail: e.target.value }))} /></div><div><label>Support phone</label><input value={restaurant.supportPhone} onChange={(e) => setRestaurant((s) => ({ ...s, supportPhone: e.target.value }))} placeholder="+27821234567" />{fieldErrors.supportPhone ? <small className="field-error">{fieldErrors.supportPhone}</small> : null}</div><div><label>Website URL</label><input value={restaurant.websiteUrl} onChange={(e) => setRestaurant((s) => ({ ...s, websiteUrl: e.target.value }))} /></div><div><label>Tax number</label><input value={restaurant.taxNumber} onChange={(e) => setRestaurant((s) => ({ ...s, taxNumber: e.target.value }))} /></div><div><label>Registration number</label><input value={restaurant.registrationNumber} onChange={(e) => setRestaurant((s) => ({ ...s, registrationNumber: e.target.value }))} /></div><div><label>Cuisine tags</label><input value={restaurant.cuisineTags} onChange={(e) => setRestaurant((s) => ({ ...s, cuisineTags: e.target.value }))} placeholder="burgers, pizza, grill" /></div><div><label>Prep time min</label><input value={restaurant.prepTimeMinMins} onChange={(e) => setRestaurant((s) => ({ ...s, prepTimeMinMins: e.target.value }))} /></div><div><label>Prep time max</label><input value={restaurant.prepTimeMaxMins} onChange={(e) => setRestaurant((s) => ({ ...s, prepTimeMaxMins: e.target.value }))} /></div><div className="full-span"><label>Description</label><textarea value={restaurant.description} onChange={(e) => setRestaurant((s) => ({ ...s, description: e.target.value }))} /></div><div className="checkbox-row"><input type="checkbox" checked={restaurant.acceptsPickup} onChange={(e) => setRestaurant((s) => ({ ...s, acceptsPickup: e.target.checked }))} /><span>Accept pickup</span></div><div className="checkbox-row"><input type="checkbox" checked={restaurant.acceptsDelivery} onChange={(e) => setRestaurant((s) => ({ ...s, acceptsDelivery: e.target.checked }))} /><span>Accept delivery</span></div></div></div><div className="panel-lite"><div className="form-grid-2"><div><label>Location name</label><input value={restaurant.locationName} onChange={(e) => setRestaurant((s) => ({ ...s, locationName: e.target.value }))} placeholder="Main Branch" /></div><div className="full-span"><label>Address line 1</label><input value={restaurant.addressLine1} onChange={(e) => setRestaurant((s) => ({ ...s, addressLine1: e.target.value }))} /></div><div className="full-span"><label>Address line 2</label><input value={restaurant.addressLine2} onChange={(e) => setRestaurant((s) => ({ ...s, addressLine2: e.target.value }))} /></div><div><label>Location / Suburb</label><input value={restaurant.suburb} onChange={(e) => setRestaurant((s) => ({ ...s, suburb: e.target.value }))} /></div><div><label>City</label><input value={restaurant.city} onChange={(e) => setRestaurant((s) => ({ ...s, city: e.target.value }))} /></div><div><label>Province</label><input value={restaurant.province} onChange={(e) => setRestaurant((s) => ({ ...s, province: e.target.value }))} /></div><div><label>Postal code</label><input value={restaurant.postalCode} onChange={(e) => setRestaurant((s) => ({ ...s, postalCode: e.target.value }))} /></div><div><label>Delivery radius (km)</label><input value={restaurant.deliveryRadiusKm} onChange={(e) => setRestaurant((s) => ({ ...s, deliveryRadiusKm: e.target.value }))} /></div></div></div></>}
        <button className="primary-btn block" disabled={loading}>{loading ? 'Submitting…' : mode === 'customer' ? 'Create account' : 'Submit application'}</button>
        <div className="auth-switch muted">Already registered? <Link to="/login">Sign in</Link></div>
      </form>
    </div>
  );
}
