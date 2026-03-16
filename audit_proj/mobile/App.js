import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import Constants from 'expo-constants';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { MapView, Marker } from './components/MapPrimitives';
import { io } from 'socket.io-client';

const Tab = createBottomTabNavigator();
const API_BASE_URL = Constants.expoConfig?.extra?.apiBaseUrl || 'http://10.0.2.2:4000/api';
const SOCKET_BASE_URL = API_BASE_URL.replace(/\/api\/?$/, '');
const LOGO = require('./assets/logo.png');
const theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: '#120702',
    card: '#2a1105',
    text: '#fff7ef',
    primary: '#ff6b00',
    border: 'rgba(255,255,255,0.08)',
  },
};
const shellStyle = { flex: 1, backgroundColor: '#120702' };

function isStrongPassword(value) {
  return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,64}$/.test(String(value || ''));
}

function isInternationalPhone(value) {
  return /^\+[1-9]\d{7,14}$/.test(String(value || '').trim());
}


async function api(path, options = {}, token) {
  const headers = { ...(options.headers || {}) };
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  if (!isFormData && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    throw new Error(payload.message || payload.error || 'Request failed');
  }
  return payload.data;
}

function resolveAssetUrl(url) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${SOCKET_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
}

function Card({ children, style }) {
  return (
    <View style={[{ backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 20, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }, style]}>
      {children}
    </View>
  );
}

function Button({ title, onPress, secondary, small, danger }) {
  const backgroundColor = danger ? '#b62323' : secondary ? 'rgba(255,255,255,0.08)' : '#ff6b00';
  const color = secondary ? '#fff7ef' : '#2a1105';
  return (
    <TouchableOpacity onPress={onPress} style={{ backgroundColor, padding: small ? 10 : 14, borderRadius: 14, marginTop: 10 }}>
      <Text style={{ color, fontWeight: '800', textAlign: 'center' }}>{title}</Text>
    </TouchableOpacity>
  );
}

function Field({ value, onChangeText, placeholder, secureTextEntry, multiline, keyboardType, autoCapitalize = 'none' }) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor="#d8bca7"
      secureTextEntry={secureTextEntry}
      multiline={multiline}
      keyboardType={keyboardType}
      autoCapitalize={autoCapitalize}
      style={{ backgroundColor: 'rgba(0,0,0,0.22)', color: '#fff7ef', borderRadius: 14, padding: 14, marginTop: 10, minHeight: multiline ? 96 : undefined, textAlignVertical: multiline ? 'top' : 'auto' }}
    />
  );
}

function SectionTitle({ eyebrow, title, subtitle }) {
  return (
    <View style={{ marginBottom: 14 }}>
      {eyebrow ? <Text style={{ color: '#ffcb45', textTransform: 'uppercase', letterSpacing: 1.2 }}>{eyebrow}</Text> : null}
      <Text style={{ color: '#fff7ef', fontSize: 28, fontWeight: '800', marginTop: 4 }}>{title}</Text>
      {subtitle ? <Text style={{ color: '#f3c8a5', marginTop: 6 }}>{subtitle}</Text> : null}
    </View>
  );
}

async function registerForPush(token) {
  if (!Device.isDevice || !token) return;
  const permission = await Notifications.requestPermissionsAsync();
  if (permission.status !== 'granted') return;
  const pushToken = (await Notifications.getExpoPushTokenAsync()).data;
  await api('/notifications/devices/register', { method: 'POST', body: JSON.stringify({ pushToken, platform: Device.osName || 'mobile' }) }, token);
}

function AuthGate({ onSession }) {
  const [mode, setMode] = useState('login');
  const [role, setRole] = useState('customer');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [form, setForm] = useState({
    fullName: '', email: '', phone: '', password: '',
    licenseNumber: '', emergencyContactName: '', emergencyContactPhone: '',
    registrationNumber: '', vehicleType: '', vehicleMake: '', vehicleModel: '', vehicleColor: '',
    ownerFullName: '', legalName: '', displayName: '', supportEmail: '', supportPhone: '', websiteUrl: '',
    addressLine1: '', suburb: '', city: '', province: '', postalCode: '', locationName: 'Main Branch'
  });

  const fieldError = (key) => fieldErrors[key] ? <Text style={{ color: '#ff8c8c', marginTop: -6, marginBottom: 6 }}>{fieldErrors[key]}</Text> : null;

  const validateForm = () => {
    const nextErrors = {};
    if (!form.email.trim()) nextErrors.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) nextErrors.email = 'Enter a valid email address';
    if (!form.password) nextErrors.password = 'Password is required';
    if (mode === 'login') return nextErrors;
    if (role !== 'restaurant' && !form.fullName.trim()) nextErrors.fullName = 'Full name is required';
    if (!isInternationalPhone(form.phone)) nextErrors.phone = 'Phone number must include a country code, for example +27821234567';
    if (!isStrongPassword(form.password)) nextErrors.password = 'Password must be 8+ characters and include uppercase, lowercase, number, and symbol';
    if (role === 'driver') {
      if (!form.licenseNumber.trim()) nextErrors.licenseNumber = 'License number is required';
      if (!form.emergencyContactName.trim()) nextErrors.emergencyContactName = 'Emergency contact name is required';
      if (!isInternationalPhone(form.emergencyContactPhone)) nextErrors.emergencyContactPhone = 'Emergency contact phone must include a country code';
      if (!form.registrationNumber.trim()) nextErrors.registrationNumber = 'Vehicle registration number is required';
    }
    if (role === 'restaurant') {
      if (!(form.ownerFullName || form.fullName).trim()) nextErrors.ownerFullName = 'Owner full name is required';
      if (!form.legalName.trim()) nextErrors.legalName = 'Legal name is required';
      if (!form.displayName.trim()) nextErrors.displayName = 'Display name is required';
      if (!form.addressLine1.trim()) nextErrors.addressLine1 = 'Address line 1 is required';
      if (!form.city.trim()) nextErrors.city = 'City is required';
      if (!form.province.trim()) nextErrors.province = 'Province is required';
      if (form.supportPhone && !isInternationalPhone(form.supportPhone)) nextErrors.supportPhone = 'Support phone must include a country code';
    }
    return nextErrors;
  };

  const submit = async () => {
    try {
      setError('');
      setFieldErrors({});
      const validationErrors = validateForm();
      if (Object.keys(validationErrors).length) {
        setFieldErrors(validationErrors);
        const first = Object.values(validationErrors)[0];
        setError(first);
        Alert.alert(mode === 'login' ? 'Sign in error' : 'Registration error', first);
        return;
      }
      const path = mode === 'login'
        ? '/auth/login'
        : role === 'driver'
          ? '/auth/register/driver'
          : role === 'restaurant'
            ? '/auth/register/restaurant'
            : '/auth/register/customer';
      const body = mode === 'login'
        ? { email: form.email, password: form.password }
        : role === 'driver'
          ? {
              fullName: form.fullName,
              email: form.email,
              phone: form.phone,
              password: form.password,
              licenseNumber: form.licenseNumber,
              emergencyContactName: form.emergencyContactName,
              emergencyContactPhone: form.emergencyContactPhone,
              registrationNumber: form.registrationNumber,
              vehicleType: form.vehicleType,
              vehicleMake: form.vehicleMake,
              vehicleModel: form.vehicleModel,
              vehicleColor: form.vehicleColor,
            }
          : role === 'restaurant'
            ? {
                ownerFullName: form.ownerFullName || form.fullName,
                email: form.email,
                phone: form.phone,
                password: form.password,
                legalName: form.legalName,
                displayName: form.displayName,
                supportEmail: form.supportEmail || form.email,
                supportPhone: form.supportPhone || form.phone,
                websiteUrl: form.websiteUrl || null,
                addressLine1: form.addressLine1,
                suburb: form.suburb || null,
                city: form.city,
                province: form.province,
                postalCode: form.postalCode || null,
                locationName: form.locationName || 'Main Branch',
                latitude: null,
                longitude: null,
                deliveryRadiusKm: 10,
                acceptsPickup: true,
                acceptsDelivery: true,
                cuisineTags: []
              }
            : { fullName: form.fullName, email: form.email, phone: form.phone, password: form.password, preferredLanguage: 'en', marketingOptIn: true };
      const session = await api(path, { method: 'POST', body: JSON.stringify(body) });
      if (mode === 'register' && (role === 'driver' || role === 'restaurant') && !session?.token) {
        Alert.alert('Application submitted', role === 'driver' ? 'Your driver application has been submitted for admin approval.' : 'Your restaurant application has been submitted for admin approval.');
        setMode('login');
        setRole('customer');
        return;
      }
      onSession(session);
    } catch (err) {
      const message = String(err.message || err);
      setError(message);
      Alert.alert(mode === 'login' ? 'Sign in failed' : 'Registration failed', message);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#120702', padding: 20, justifyContent: 'center' }}>
      <Card>
        <View style={{ alignItems: 'center', marginBottom: 10 }}>
          <Image source={LOGO} style={{ width: 92, height: 92, borderRadius: 24 }} resizeMode="contain" />
        </View>
        <Text style={{ color: '#ffcb45', textTransform: 'uppercase', letterSpacing: 1.4, marginBottom: 6, textAlign: 'center' }}>Food delivery mobile</Text>
        <Text style={{ color: '#fff7ef', fontSize: 28, fontWeight: '800', textAlign: 'center' }}>{mode === 'login' ? 'Welcome back' : 'Create account'}</Text>
        {!!error ? <Text style={{ color: '#ff8c8c', marginTop: 10, textAlign: 'center' }}>{error}</Text> : null}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
          <TouchableOpacity onPress={() => setMode('login')} style={{ flex: 1, backgroundColor: mode === 'login' ? '#ff6b00' : 'rgba(255,255,255,0.08)', padding: 12, borderRadius: 12 }}><Text style={{ color: mode === 'login' ? '#2a1105' : '#fff7ef', textAlign: 'center', fontWeight: '700' }}>Login</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => setMode('register')} style={{ flex: 1, backgroundColor: mode === 'register' ? '#ff6b00' : 'rgba(255,255,255,0.08)', padding: 12, borderRadius: 12 }}><Text style={{ color: mode === 'register' ? '#2a1105' : '#fff7ef', textAlign: 'center', fontWeight: '700' }}>Register</Text></TouchableOpacity>
        </View>
        {mode === 'register' ? (
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
            <TouchableOpacity onPress={() => setRole('customer')} style={{ flex: 1, backgroundColor: role === 'customer' ? '#ffcb45' : 'rgba(255,255,255,0.08)', padding: 12, borderRadius: 12 }}><Text style={{ color: '#2a1105', textAlign: 'center', fontWeight: '700' }}>Customer</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => setRole('driver')} style={{ flex: 1, backgroundColor: role === 'driver' ? '#ffcb45' : 'rgba(255,255,255,0.08)', padding: 12, borderRadius: 12 }}><Text style={{ color: '#2a1105', textAlign: 'center', fontWeight: '700' }}>Driver</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => setRole('restaurant')} style={{ flex: 1, backgroundColor: role === 'restaurant' ? '#ffcb45' : 'rgba(255,255,255,0.08)', padding: 12, borderRadius: 12 }}><Text style={{ color: '#2a1105', textAlign: 'center', fontWeight: '700' }}>Restaurant</Text></TouchableOpacity>
          </View>
        ) : null}
        <ScrollView style={{ maxHeight: 460, marginTop: 4 }}>
          {mode === 'register' && role !== 'restaurant' ? <><Field value={form.fullName} onChangeText={(v) => setForm({ ...form, fullName: v })} placeholder="Full name" autoCapitalize="words" />{fieldError('fullName')}</> : null}
          {mode === 'register' && role === 'restaurant' ? <><Field value={form.ownerFullName} onChangeText={(v) => setForm({ ...form, ownerFullName: v })} placeholder="Owner full name" autoCapitalize="words" />{fieldError('ownerFullName')}</> : null}
          <Field value={form.email} onChangeText={(v) => setForm({ ...form, email: v })} placeholder="Email" keyboardType="email-address" />
          {fieldError('email')}
          {mode === 'register' ? <><Field value={form.phone} onChangeText={(v) => setForm({ ...form, phone: v })} placeholder="Phone with country code" keyboardType="phone-pad" />{fieldError('phone')}</> : null}
          <Field value={form.password} onChangeText={(v) => setForm({ ...form, password: v })} placeholder="Password" secureTextEntry />
          {fieldError('password')}
          {mode === 'register' && role === 'driver' ? (
            <>
              <Field value={form.licenseNumber} onChangeText={(v) => setForm({ ...form, licenseNumber: v })} placeholder="License number" />
              {fieldError('licenseNumber')}
              <Field value={form.emergencyContactName} onChangeText={(v) => setForm({ ...form, emergencyContactName: v })} placeholder="Emergency contact name" autoCapitalize="words" />
              {fieldError('emergencyContactName')}
              <Field value={form.emergencyContactPhone} onChangeText={(v) => setForm({ ...form, emergencyContactPhone: v })} placeholder="Emergency contact phone" keyboardType="phone-pad" />
              {fieldError('emergencyContactPhone')}
              <Field value={form.registrationNumber} onChangeText={(v) => setForm({ ...form, registrationNumber: v })} placeholder="Vehicle registration number" autoCapitalize="characters" />
              {fieldError('registrationNumber')}
              <Field value={form.vehicleType} onChangeText={(v) => setForm({ ...form, vehicleType: v })} placeholder="Vehicle type" autoCapitalize="words" />
              <Field value={form.vehicleMake} onChangeText={(v) => setForm({ ...form, vehicleMake: v })} placeholder="Vehicle make" autoCapitalize="words" />
              <Field value={form.vehicleModel} onChangeText={(v) => setForm({ ...form, vehicleModel: v })} placeholder="Vehicle model" autoCapitalize="words" />
              <Field value={form.vehicleColor} onChangeText={(v) => setForm({ ...form, vehicleColor: v })} placeholder="Vehicle color" autoCapitalize="words" />
            </>
          ) : null}
          {mode === 'register' && role === 'restaurant' ? (
            <>
              <Field value={form.legalName} onChangeText={(v) => setForm({ ...form, legalName: v })} placeholder="Legal business name" autoCapitalize="words" />
              {fieldError('legalName')}
              <Field value={form.displayName} onChangeText={(v) => setForm({ ...form, displayName: v })} placeholder="Display name" autoCapitalize="words" />
              {fieldError('displayName')}
              <Field value={form.supportEmail} onChangeText={(v) => setForm({ ...form, supportEmail: v })} placeholder="Support email" keyboardType="email-address" />
              <Field value={form.supportPhone} onChangeText={(v) => setForm({ ...form, supportPhone: v })} placeholder="Support phone with country code" keyboardType="phone-pad" />
              {fieldError('supportPhone')}
              <Field value={form.websiteUrl} onChangeText={(v) => setForm({ ...form, websiteUrl: v })} placeholder="Website (optional)" autoCapitalize="none" />
              <Field value={form.locationName} onChangeText={(v) => setForm({ ...form, locationName: v })} placeholder="Location name" autoCapitalize="words" />
              <Field value={form.addressLine1} onChangeText={(v) => setForm({ ...form, addressLine1: v })} placeholder="Address line 1" autoCapitalize="words" />
              {fieldError('addressLine1')}
              <Field value={form.suburb} onChangeText={(v) => setForm({ ...form, suburb: v })} placeholder="Suburb / area" autoCapitalize="words" />
              <Field value={form.city} onChangeText={(v) => setForm({ ...form, city: v })} placeholder="City" autoCapitalize="words" />
              {fieldError('city')}
              <Field value={form.province} onChangeText={(v) => setForm({ ...form, province: v })} placeholder="Province" autoCapitalize="words" />
              {fieldError('province')}
              <Field value={form.postalCode} onChangeText={(v) => setForm({ ...form, postalCode: v })} placeholder="Postal code" keyboardType="number-pad" />
            </>
          ) : null}
        </ScrollView>
        <Button title={mode === 'login' ? 'Sign in' : 'Continue'} onPress={submit} />
      </Card>
    </SafeAreaView>
  );
}

function RestaurantTile({ item }) {
  const logo = resolveAssetUrl(item.logo_url);
  return (
    <Card>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <Image source={logo ? { uri: logo } : LOGO} style={{ width: 60, height: 60, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.08)' }} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#fff7ef', fontSize: 18, fontWeight: '700' }}>{item.display_name}</Text>
          <Text style={{ color: '#f3c8a5', marginTop: 4 }}>{item.city || item.province || 'Nearby'}</Text>
          <Text style={{ color: '#ffcb45', marginTop: 6 }}>★ {Number(item.average_rating || 0).toFixed(1)}</Text>
        </View>
      </View>
      {item.description ? <Text style={{ color: '#f3c8a5', marginTop: 10 }}>{item.description}</Text> : null}
    </Card>
  );
}

function CustomerHome({ token }) {
  const [data, setData] = useState(null);
  useEffect(() => { api('/customer/home', {}, token).then(setData).catch((e) => Alert.alert('Load failed', e.message)); }, [token]);
  return (
    <ScrollView style={{ ...shellStyle, padding: 16 }}>
      <SectionTitle eyebrow="Customer" title="Discover & order" subtitle="Browse approved restaurants and food deals near you." />
      {!data ? <ActivityIndicator color="#ff6b00" /> : (
        <>
          <Card>
            <Text style={{ color: '#f3c8a5' }}>Loyalty points</Text>
            <Text style={{ color: '#fff7ef', fontSize: 28, fontWeight: '800' }}>{data.loyalty?.loyalty_points || 0}</Text>
          </Card>
          <FlatList scrollEnabled={false} data={data.featuredRestaurants || data.restaurants || []} keyExtractor={(item) => item.id} renderItem={({ item }) => <RestaurantTile item={item} />} />
        </>
      )}
    </ScrollView>
  );
}

function DealsScreen({ token }) {
  const [deals, setDeals] = useState([]);
  useEffect(() => { api('/customer/deals', {}, token).then((d) => setDeals(d.coupons || d.deals || [])).catch((e) => Alert.alert('Deals failed', e.message)); }, [token]);
  return (
    <ScrollView style={{ ...shellStyle, padding: 16 }}>
      <SectionTitle eyebrow="Deals" title="Promo codes & specials" subtitle="Coupons and restaurant specials available for your next order." />
      {deals.length === 0 ? <Card><Text style={{ color: '#f3c8a5' }}>No active deals right now.</Text></Card> : deals.map((deal) => (
        <Card key={deal.id || deal.code}>
          <Text style={{ color: '#ffcb45', fontWeight: '800', fontSize: 22 }}>{deal.code || deal.title}</Text>
          <Text style={{ color: '#fff7ef', fontWeight: '700', marginTop: 8 }}>{deal.name || deal.title}</Text>
          <Text style={{ color: '#f3c8a5', marginTop: 6 }}>{deal.description || 'Restaurant special'}</Text>
          {deal.restaurant_name ? <Text style={{ color: '#fff7ef', marginTop: 8 }}>Restaurant: {deal.restaurant_name}</Text> : null}
        </Card>
      ))}
    </ScrollView>
  );
}

function PaymentOptionChip({ selected, label, onPress }) {
  return (
    <Pressable onPress={onPress} style={{ backgroundColor: selected ? '#ffcb45' : 'rgba(255,255,255,0.08)', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 999, marginRight: 8, marginBottom: 8 }}>
      <Text style={{ color: selected ? '#2a1105' : '#fff7ef', fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

function CartScreen({ token }) {
  const [paymentMethod, setPaymentMethod] = useState('card');
  const [cardNumber, setCardNumber] = useState('');
  const [bankReference, setBankReference] = useState('');
  const [selectedSavedCard, setSelectedSavedCard] = useState('');
  const [savedCards, setSavedCards] = useState([]);
  useEffect(() => { api('/payments/methods/saved', {}, token).then((d) => setSavedCards(d.paymentMethods || d || [])).catch(() => undefined); }, [token]);
  return (
    <ScrollView style={{ ...shellStyle, padding: 16 }}>
      <SectionTitle eyebrow="Checkout" title="Choose payment" subtitle="Only the selected payment option stays visible." />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        <PaymentOptionChip selected={paymentMethod === 'card'} label="Card" onPress={() => setPaymentMethod('card')} />
        <PaymentOptionChip selected={paymentMethod === 'saved_card'} label="Saved card" onPress={() => setPaymentMethod('saved_card')} />
        <PaymentOptionChip selected={paymentMethod === 'eft_bank_transfer'} label="EFT / Bank transfer" onPress={() => setPaymentMethod('eft_bank_transfer')} />
        <PaymentOptionChip selected={paymentMethod === 'cash_on_delivery'} label="Cash on delivery" onPress={() => setPaymentMethod('cash_on_delivery')} />
      </View>
      <Card>
        <Text style={{ color: '#fff7ef', fontWeight: '800' }}>Selected: {paymentMethod.replaceAll('_', ' ')}</Text>
        {paymentMethod === 'card' ? <Field value={cardNumber} onChangeText={setCardNumber} placeholder="Card number" keyboardType="number-pad" /> : null}
        {paymentMethod === 'saved_card' ? (
          <>
            {savedCards.length === 0 ? <Text style={{ color: '#f3c8a5', marginTop: 8 }}>No saved cards available.</Text> : savedCards.map((card) => (
              <Pressable key={card.id} onPress={() => setSelectedSavedCard(card.id)} style={{ backgroundColor: selectedSavedCard === card.id ? '#ffcb45' : 'rgba(255,255,255,0.08)', padding: 12, borderRadius: 14, marginTop: 10 }}>
                <Text style={{ color: selectedSavedCard === card.id ? '#2a1105' : '#fff7ef', fontWeight: '700' }}>{card.brand || 'Card'} •••• {card.last4 || '0000'}</Text>
              </Pressable>
            ))}
          </>
        ) : null}
        {paymentMethod === 'eft_bank_transfer' ? <Field value={bankReference} onChangeText={setBankReference} placeholder="Bank transfer reference" /> : null}
        {paymentMethod === 'cash_on_delivery' ? <Text style={{ color: '#f3c8a5', marginTop: 10 }}>Pay the driver when your order arrives.</Text> : null}
        <Button title="Change payment option" secondary onPress={() => Alert.alert('Payment option', 'Select another payment type from the chips above.')} />
      </Card>
    </ScrollView>
  );
}

function CustomerOrders({ token }) {
  const [orders, setOrders] = useState([]);
  const [cancelReason, setCancelReason] = useState('Ordered by mistake');
  const load = () => api('/customer/orders', {}, token).then(setOrders).catch((e) => Alert.alert('Orders failed', e.message));
  useEffect(() => {
    load();
    const socket = io(SOCKET_BASE_URL, { transports: ['websocket', 'polling'], auth: { token } });
    socket.on('order:status_changed', () => load());
    socket.on('delivery:accepted', () => load());
    return () => socket.disconnect();
  }, [token]);
  return (
    <ScrollView style={{ ...shellStyle, padding: 16 }}>
      <SectionTitle eyebrow="Orders" title="Live order status" subtitle="Track restaurant and driver updates in real time." />
      {orders.map((item) => (
        <Card key={item.id}>
          <Text style={{ color: '#fff7ef', fontWeight: '700' }}>{item.restaurant_name}</Text>
          <Text style={{ color: '#f3c8a5', marginTop: 6 }}>{item.status} · {item.delivery_status || 'no driver yet'}</Text>
          {item.driver_name ? <Text style={{ color: '#fff7ef', marginTop: 8 }}>Driver: {item.driver_name}</Text> : null}
          {item.vehicle_registration ? <Text style={{ color: '#fff7ef', marginTop: 4 }}>Vehicle: {item.vehicle_registration}</Text> : null}
          {['placed','confirmed','preparing','ready_for_pickup'].includes(item.status) ? <>
            <Field value={cancelReason} onChangeText={setCancelReason} placeholder="Cancellation reason" autoCapitalize="sentences" />
            <Button title="Cancel order" danger onPress={async () => { try { await api(`/customer/orders/${item.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason: cancelReason }) }, token); load(); } catch (err) { Alert.alert('Cancel failed', String(err.message || err)); } }} />
          </> : null}
        </Card>
      ))}
    </ScrollView>
  );
}

function AddressesScreen({ token }) {
  const [addresses, setAddresses] = useState([]);
  const [saving, setSaving] = useState(false);
  const [mapVisible, setMapVisible] = useState(false);
  const [region, setRegion] = useState({ latitude: -26.2041, longitude: 28.0473, latitudeDelta: 0.02, longitudeDelta: 0.02 });
  const [form, setForm] = useState({ label: 'Home', addressLine1: '', addressLine2: '', suburb: '', city: '', province: '', postalCode: '', deliveryInstructions: '', latitude: '', longitude: '' });

  const load = () => api('/customer/addresses', {}, token).then((d) => setAddresses(d.addresses || d || [])).catch((e) => Alert.alert('Addresses failed', e.message));
  useEffect(() => { load(); }, [token]);

  const useCurrentLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') throw new Error('Location permission not granted');
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const nextRegion = { latitude: current.coords.latitude, longitude: current.coords.longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 };
      setRegion(nextRegion);
      setForm((prev) => ({ ...prev, latitude: String(current.coords.latitude), longitude: String(current.coords.longitude) }));
      setMapVisible(true);
    } catch (err) {
      Alert.alert('Location unavailable', String(err.message || err));
    }
  };

  const saveAddress = async () => {
    try {
      setSaving(true);
      await api('/customer/addresses', {
        method: 'POST',
        body: JSON.stringify({
          label: form.label,
          addressLine1: form.addressLine1,
          addressLine2: form.addressLine2,
          locationLabel: form.suburb,
          city: form.city,
          province: form.province,
          postalCode: form.postalCode,
          latitude: form.latitude ? Number(form.latitude) : null,
          longitude: form.longitude ? Number(form.longitude) : null,
          deliveryInstructions: form.deliveryInstructions,
          isDefault: true,
        }),
      }, token);
      Alert.alert('Saved', 'Delivery address saved successfully.');
      setForm({ label: 'Home', addressLine1: '', addressLine2: '', suburb: '', city: '', province: '', postalCode: '', deliveryInstructions: '', latitude: '', longitude: '' });
      load();
    } catch (err) {
      Alert.alert('Save failed', String(err.message || err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={{ ...shellStyle, padding: 16 }}>
      <SectionTitle eyebrow="Addresses" title="Delivery location" subtitle="Use your current location, pick an exact pin, and add delivery instructions." />
      <Card>
        <Button title="Use my current location" onPress={useCurrentLocation} />
        <Button title="Open map" secondary onPress={() => setMapVisible(true)} />
        <Field value={form.label} onChangeText={(v) => setForm({ ...form, label: v })} placeholder="Label" autoCapitalize="words" />
        <Field value={form.addressLine1} onChangeText={(v) => setForm({ ...form, addressLine1: v })} placeholder="Address line 1" autoCapitalize="words" />
        <Field value={form.addressLine2} onChangeText={(v) => setForm({ ...form, addressLine2: v })} placeholder="Address line 2" autoCapitalize="words" />
        <Field value={form.suburb} onChangeText={(v) => setForm({ ...form, suburb: v })} placeholder="Suburb / location" autoCapitalize="words" />
        <Field value={form.city} onChangeText={(v) => setForm({ ...form, city: v })} placeholder="City" autoCapitalize="words" />
        <Field value={form.province} onChangeText={(v) => setForm({ ...form, province: v })} placeholder="Province" autoCapitalize="words" />
        <Field value={form.postalCode} onChangeText={(v) => setForm({ ...form, postalCode: v })} placeholder="Postal code" keyboardType="number-pad" />
        <Field value={form.deliveryInstructions} onChangeText={(v) => setForm({ ...form, deliveryInstructions: v })} placeholder="Extra delivery information" multiline autoCapitalize="sentences" />
        <Text style={{ color: '#f3c8a5', marginTop: 8 }}>Latitude: {form.latitude || 'not set'} · Longitude: {form.longitude || 'not set'}</Text>
        <Button title={saving ? 'Saving...' : 'Save address'} onPress={saveAddress} />
      </Card>
      {addresses.map((item) => (
        <Card key={item.id}>
          <Text style={{ color: '#fff7ef', fontWeight: '700' }}>{item.label}</Text>
          <Text style={{ color: '#f3c8a5', marginTop: 6 }}>{item.address_line_1 || item.addressLine1}</Text>
          <Text style={{ color: '#f3c8a5' }}>{item.city}, {item.province}</Text>
          {(item.latitude || item.longitude) ? <Text style={{ color: '#fff7ef', marginTop: 8 }}>Pin: {item.latitude}, {item.longitude}</Text> : null}
          {item.delivery_instructions || item.deliveryInstructions ? <Text style={{ color: '#fff7ef', marginTop: 8 }}>Info: {item.delivery_instructions || item.deliveryInstructions}</Text> : null}
        </Card>
      ))}
      <Modal visible={mapVisible} animationType="slide">
        <SafeAreaView style={{ flex: 1, backgroundColor: '#120702' }}>
          <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' }}>
            <Text style={{ color: '#fff7ef', fontSize: 22, fontWeight: '800' }}>Pick exact delivery pin</Text>
            <Text style={{ color: '#f3c8a5', marginTop: 6 }}>Tap anywhere on the map to set the delivery location.</Text>
          </View>
          <MapView style={{ flex: 1 }} initialRegion={region} region={region} onPress={(e) => {
            const { latitude, longitude } = e.nativeEvent.coordinate;
            setRegion((prev) => ({ ...prev, latitude, longitude }));
            setForm((prev) => ({ ...prev, latitude: String(latitude), longitude: String(longitude) }));
          }} onRegionChangeComplete={(r) => setRegion(r)}>
            <Marker coordinate={{ latitude: Number(form.latitude || region.latitude), longitude: Number(form.longitude || region.longitude) }} />
          </MapView>
          <View style={{ padding: 16 }}>
            <Button title="Use this pin" onPress={() => setMapVisible(false)} />
            <Button title="Close map" secondary onPress={() => setMapVisible(false)} />
          </View>
        </SafeAreaView>
      </Modal>
    </ScrollView>
  );
}

function ProfileScreen({ token, session, onSessionChange, onLogout }) {
  const [form, setForm] = useState({ fullName: session.user.fullName || '', phone: session.user.phone || '', password: '' });
  const [summary, setSummary] = useState(null);
  const [account, setAccount] = useState({ holderScope: session.user.roles?.includes('driver') ? 'driver' : 'restaurant', accountName: '', bankName: '', accountNumber: '', branchCode: '', accountType: '' });
  useEffect(() => { api('/payouts/summary', {}, token).then(setSummary).catch(() => undefined); }, [token]);
  const save = async () => {
    try {
      const data = await api('/auth/profile', { method: 'PUT', body: JSON.stringify({ fullName: form.fullName, phone: form.phone, password: form.password || undefined }) }, token);
      onSessionChange({ ...session, user: { ...session.user, ...data.user } });
      Alert.alert('Saved', 'Profile updated successfully.');
    } catch (err) {
      Alert.alert('Update failed', String(err.message || err));
    }
  };
  return (
    <ScrollView style={{ ...shellStyle, padding: 16 }}>
      <SectionTitle eyebrow="Profile" title={`Welcome, ${session.user.fullName || 'there'}`} subtitle="Update your personal details and sign out when you are done." />
      <Card>
        <Field value={form.fullName} onChangeText={(v) => setForm({ ...form, fullName: v })} placeholder="Full name" autoCapitalize="words" />
        <Field value={form.phone} onChangeText={(v) => setForm({ ...form, phone: v })} placeholder="Phone with country code" keyboardType="phone-pad" />
        <Field value={form.password} onChangeText={(v) => setForm({ ...form, password: v })} placeholder="New password" secureTextEntry />
        <Button title="Save profile" onPress={save} />
        {summary?.driver ? <Text style={{ color: '#fff7ef', marginTop: 12 }}>Driver available balance: {summary.driver.available_balance}</Text> : null}
        {summary?.restaurant ? <Text style={{ color: '#fff7ef', marginTop: 12 }}>Restaurant balance: {summary.restaurant.available_balance} · Commission {summary.restaurant.applied_commission_rate}%</Text> : null}
        <Field value={account.accountName} onChangeText={(v) => setAccount({ ...account, accountName: v })} placeholder="Payout account name" autoCapitalize="words" />
        <Field value={account.bankName} onChangeText={(v) => setAccount({ ...account, bankName: v })} placeholder="Bank name" autoCapitalize="words" />
        <Field value={account.accountNumber} onChangeText={(v) => setAccount({ ...account, accountNumber: v })} placeholder="Account number" keyboardType="number-pad" />
        <Button title="Save payout account" secondary onPress={async () => { try { await api('/payouts/bank-accounts', { method: 'POST', body: JSON.stringify(account) }, token); Alert.alert('Saved', 'Payout account saved.'); } catch (err) { Alert.alert('Save failed', String(err.message || err)); } }} />
        <Button title="Sign out" danger onPress={onLogout} />
      </Card>
    </ScrollView>
  );
}

function DriverHub({ token, user, onLogout }) {
  const [deliveries, setDeliveries] = useState([]);
  const [trackingState, setTrackingState] = useState('idle');
  const [payoutByDelivery, setPayoutByDelivery] = useState({});
  const load = () => api('/driver/deliveries', {}, token).then(setDeliveries).catch((e) => Alert.alert('Deliveries failed', e.message));
  useEffect(() => {
    load();
    const socket = io(SOCKET_BASE_URL, { transports: ['websocket', 'polling'], auth: { token } });
    socket.on('order:status_changed', () => load());
    socket.on('delivery:accepted', () => load());
    return () => socket.disconnect();
  }, [token]);
  const sendLocation = async () => {
    try {
      setTrackingState('requesting');
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') throw new Error('Location permission not granted');
      const location = await Location.getCurrentPositionAsync({});
      await api('/driver/location', { method: 'POST', body: JSON.stringify({ latitude: location.coords.latitude, longitude: location.coords.longitude, speedKph: location.coords.speed || 0, headingDeg: location.coords.heading || 0, accuracyM: location.coords.accuracy || 0 }) }, token);
      setTrackingState('live');
      Alert.alert('Location shared', 'Driver location sent to the platform.');
    } catch (error) {
      setTrackingState('error');
      Alert.alert('Location failed', String(error.message || error));
    }
  };
  return (
    <ScrollView style={{ ...shellStyle, padding: 16 }}>
      <SectionTitle eyebrow="Driver" title="Deliveries & tracking" subtitle="Accept jobs, send live location, and return to auth after logout." />
      <Card>
        <Text style={{ color: '#fff7ef', fontWeight: '700' }}>{user.fullName}</Text>
        <Text style={{ color: '#f3c8a5', marginTop: 6 }}>Live tracking state: {trackingState}</Text>
        <Button title="Send live location" onPress={sendLocation} />
        <Button title="Sign out" danger onPress={onLogout} />
      </Card>
      {deliveries.map((item) => (
        <Card key={item.id}>
          <Text style={{ color: '#fff7ef', fontWeight: '700' }}>{item.restaurant_name}</Text>
          <Text style={{ color: '#f3c8a5', marginTop: 6 }}>{item.status}</Text>
          {!item.is_mine ? <>
            <Field value={payoutByDelivery[item.id] || ''} onChangeText={(v) => setPayoutByDelivery((prev) => ({ ...prev, [item.id]: v }))} placeholder="Your delivery amount" keyboardType="numeric" />
            <Button title="Accept delivery" onPress={async () => { await api(`/driver/deliveries/${item.id}/accept`, { method: 'POST', body: JSON.stringify({ requestedPayout: payoutByDelivery[item.id] ? Number(payoutByDelivery[item.id]) : undefined }) }, token); load(); }} />
          </> : <>
            {item.restaurant_nav_url ? <Button title="Navigate restaurant" secondary onPress={() => Alert.alert('Navigation', item.restaurant_nav_url)} /> : null}
            {item.customer_nav_url ? <Button title="Navigate customer" secondary onPress={() => Alert.alert('Navigation', item.customer_nav_url)} /> : null}
          </>}
        </Card>
      ))}
    </ScrollView>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const role = useMemo(() => session?.user?.roles?.includes('driver') ? 'driver' : 'customer', [session]);
  useEffect(() => { if (session?.token) registerForPush(session.token).catch(() => undefined); }, [session?.token]);
  const logout = () => setSession(null);
  if (!session) return <AuthGate onSession={setSession} />;
  return (
    <NavigationContainer theme={theme}>
      <Tab.Navigator screenOptions={{ headerShown: false, tabBarStyle: { backgroundColor: '#2a1105', borderTopColor: 'rgba(255,255,255,0.08)' }, tabBarActiveTintColor: '#ffcb45', tabBarInactiveTintColor: '#f3c8a5' }}>
        {role === 'driver' ? (
          <>
            <Tab.Screen name="DriverHome">{() => <DriverHub token={session.token} user={session.user} onLogout={logout} />}</Tab.Screen>
          </>
        ) : (
          <>
            <Tab.Screen name="Discover">{() => <CustomerHome token={session.token} />}</Tab.Screen>
            <Tab.Screen name="Deals">{() => <DealsScreen token={session.token} />}</Tab.Screen>
            <Tab.Screen name="Cart">{() => <CartScreen token={session.token} />}</Tab.Screen>
            <Tab.Screen name="Orders">{() => <CustomerOrders token={session.token} />}</Tab.Screen>
            <Tab.Screen name="Addresses">{() => <AddressesScreen token={session.token} />}</Tab.Screen>
            <Tab.Screen name="Profile">{() => <ProfileScreen token={session.token} session={session} onSessionChange={setSession} onLogout={logout} />}</Tab.Screen>
          </>
        )}
      </Tab.Navigator>
    </NavigationContainer>
  );
}
