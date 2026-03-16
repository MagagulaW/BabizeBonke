import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
  StatusBar,
} from 'react-native';
import { NavigationContainer, DefaultTheme, useFocusEffect } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import Constants from 'expo-constants';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Device from 'expo-device';
import { MapView, Marker } from './components/MapPrimitives';
import { io } from 'socket.io-client';
import { Ionicons } from '@expo/vector-icons';

const Tab = createBottomTabNavigator();

function normalizeApiBaseUrl(value) {
  const trimmed = String(value || '').trim().replace(/\/$/, '');
  if (!trimmed) return '';
  if (/\/api$/i.test(trimmed)) return trimmed;
  return `${trimmed}/api`;
}

function resolveApiBaseUrl() {
  const explicit = Constants.expoConfig?.extra?.apiBaseUrl || Constants.manifest2?.extra?.expoClient?.extra?.apiBaseUrl;
  const normalizedExplicit = normalizeApiBaseUrl(explicit);
  if (normalizedExplicit) return normalizedExplicit;
  const debuggerHost = Constants.expoConfig?.hostUri || Constants.manifest2?.extra?.expoGo?.debuggerHost || Constants.manifest?.debuggerHost;
  if (debuggerHost) {
    const host = String(debuggerHost).split(':')[0];
    if (host && host !== 'localhost' && host !== '127.0.0.1') return `http://${host}:4000/api`;
  }
  return 'http://127.0.0.1:4000/api';
}

let runtimeApiBaseUrl = resolveApiBaseUrl();
function setRuntimeApiBaseUrl(value) {
  const normalized = normalizeApiBaseUrl(value);
  if (normalized) runtimeApiBaseUrl = normalized;
}
function getApiBaseUrl() {
  return runtimeApiBaseUrl;
}
function getSocketBaseUrl() {
  return getApiBaseUrl().replace(/\/api\/?$/, '');
}

const LOGO = require('./assets/logo.png');

const palettes = {
  dark: {
    mode: 'dark',
    background: '#120702',
    surface: '#1b0d08',
    surfaceSoft: '#2a1105',
    card: 'rgba(255,255,255,0.06)',
    text: '#fff7ef',
    textMuted: '#f3c8a5',
    textSoft: '#d8bca7',
    primary: '#ff6b00',
    primaryText: '#2a1105',
    border: 'rgba(255,255,255,0.08)',
    overlay: 'rgba(0,0,0,0.75)',
    warning: '#ffcb45',
  },
  light: {
    mode: 'light',
    background: '#ffffff',
    surface: '#fff7f1',
    surfaceSoft: '#ffffff',
    card: '#ffffff',
    text: '#20110a',
    textMuted: '#5c4032',
    textSoft: '#8e6d5a',
    primary: '#ff6b00',
    primaryText: '#ffffff',
    border: 'rgba(32,17,10,0.08)',
    overlay: 'rgba(0,0,0,0.4)',
    warning: '#ff9f1a',
  },
};
let runtimeThemeMode = 'dark';
function getPalette() {
  return palettes[runtimeThemeMode] || palettes.dark;
}
function setRuntimeThemeMode(mode) {
  runtimeThemeMode = mode === 'light' ? 'light' : 'dark';
}
function buildNavigationTheme() {
  const palette = getPalette();
  return {
    ...DefaultTheme,
    dark: palette.mode === 'dark',
    colors: {
      ...DefaultTheme.colors,
      background: palette.background,
      card: palette.surfaceSoft,
      text: palette.text,
      primary: palette.primary,
      border: palette.border,
      notification: palette.primary,
    },
  };
}
function shellStyle(extra = {}) {
  return { flex: 1, backgroundColor: getPalette().background, ...extra };
}

const authStyles = {
  screen: () => ({ flex: 1, backgroundColor: getPalette().background }),
  container: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  card: () => ({ backgroundColor: getPalette().surface, borderRadius: 28, padding: 20, borderWidth: 1, borderColor: getPalette().border }),
  segmentedRow: { flexDirection: 'row', gap: 10, marginTop: 18 },
  segmentedBtn: { flex: 1, paddingVertical: 12, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  modalBackdrop: () => ({ flex: 1, backgroundColor: getPalette().overlay, justifyContent: 'center', alignItems: 'center', padding: 20 }),
  modalCard: () => ({ width: '100%', maxWidth: 420, backgroundColor: getPalette().surface, borderRadius: 24, padding: 20, borderWidth: 1, borderColor: getPalette().border }),
};

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
  const response = await fetch(`${getApiBaseUrl()}${path}`, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    throw new Error(payload.message || payload.error || 'Request failed');
  }
  return payload.data;
}

function resolveAssetUrl(url) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${getSocketBaseUrl()}${url.startsWith('/') ? '' : '/'}${url}`;
}

function formatAddress(parts = {}) {
  return [parts.address_label, parts.address_line1, parts.address_line2, parts.suburb, parts.city, parts.province, parts.postal_code]
    .filter(Boolean)
    .join(', ');
}

function createRegion(latitude, longitude, latDelta = 0.03, longitudeDelta = 0.03) {
  return {
    latitude: Number(latitude) || -25.748,
    longitude: Number(longitude) || 28.229,
    latitudeDelta: latDelta,
    longitudeDelta,
  };
}

function getDriverStatusSteps(status) {
  const steps = ['accepted', 'en_route_to_pickup', 'arrived_at_pickup', 'picked_up', 'en_route_to_dropoff', 'arrived_at_dropoff', 'delivered'];
  const currentIndex = Math.max(0, steps.indexOf(status));
  return steps.map((step, index) => ({
    key: step,
    label: step.replace(/_/g, ' '),
    done: currentIndex >= index || status === 'delivered',
    active: currentIndex === index && status !== 'delivered',
  }));
}

const driverStatusActions = [
  { value: 'accepted', label: 'Accepted' },
  { value: 'en_route_to_pickup', label: 'To restaurant' },
  { value: 'arrived_at_pickup', label: 'At restaurant' },
  { value: 'picked_up', label: 'Picked up' },
  { value: 'en_route_to_dropoff', label: 'To customer' },
  { value: 'arrived_at_dropoff', label: 'At customer' },
  { value: 'delivered', label: 'Delivered' },
];

function Card({ children, style }) {
  const palette = getPalette();
  return (
    <View style={[{ backgroundColor: palette.card, borderRadius: 22, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: palette.border, shadowColor: '#000', shadowOpacity: palette.mode === 'dark' ? 0.12 : 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 }, style]}>
      {children}
    </View>
  );
}

function Button({ title, onPress, secondary, small, danger, loading, disabled, icon }) {
  const palette = getPalette();
  const backgroundColor = danger ? '#b62323' : secondary ? palette.surfaceSoft : palette.primary;
  const color = danger ? '#ffffff' : secondary ? palette.text : palette.primaryText;
  const isDisabled = !!disabled || !!loading;
  return (
    <TouchableOpacity activeOpacity={0.85} disabled={isDisabled} onPress={onPress} style={{ backgroundColor, opacity: isDisabled ? 0.65 : 1, paddingVertical: small ? 10 : 14, paddingHorizontal: 16, borderRadius: 999, marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: secondary ? 1 : 0, borderColor: palette.border }}>
      {loading ? <ActivityIndicator color={color} /> : <>
        {icon ? <Ionicons name={icon} size={18} color={color} style={{ marginRight: 8 }} /> : null}
        <Text style={{ color, fontWeight: '800', textAlign: 'center' }}>{title}</Text>
      </>}
    </TouchableOpacity>
  );
}

function Field({ value, onChangeText, placeholder, secureTextEntry, multiline, keyboardType, autoCapitalize = 'none' }) {
  const palette = getPalette();
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={palette.textSoft}
      secureTextEntry={secureTextEntry}
      multiline={multiline}
      keyboardType={keyboardType}
      autoCapitalize={autoCapitalize}
      style={{ backgroundColor: palette.mode === 'dark' ? 'rgba(0,0,0,0.22)' : '#fff7f1', color: palette.text, borderRadius: 16, padding: 14, marginTop: 10, minHeight: multiline ? 96 : undefined, textAlignVertical: multiline ? 'top' : 'auto', borderWidth: 1, borderColor: palette.border }}
    />
  );
}

function SectionTitle({ eyebrow, title, subtitle, right }) {
  const palette = getPalette();
  return (
    <View style={{ marginBottom: 14, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
      <View style={{ flex: 1 }}>
        {eyebrow ? <Text style={{ color: palette.warning, textTransform: 'uppercase', letterSpacing: 1.2 }}>{eyebrow}</Text> : null}
        <Text style={{ color: palette.text, fontSize: 28, fontWeight: '800', marginTop: 4 }}>{title}</Text>
        {subtitle ? <Text style={{ color: palette.textMuted, marginTop: 6 }}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

async function registerForPush(token) {
  if (!Device.isDevice || !token) return;
  const isExpoGo = Constants.appOwnership === 'expo';
  if (isExpoGo) {
    console.log('Skipping push registration in Expo Go. Use a development build for remote notifications.');
    return;
  }
  try {
    const permission = await Notifications.requestPermissionsAsync();
    if (permission.status !== 'granted') return;
    const pushToken = (await Notifications.getExpoPushTokenAsync()).data;
    await api('/notifications/devices/register', { method: 'POST', body: JSON.stringify({ pushToken, platform: Device.osName || 'mobile' }) }, token);
  } catch (error) {
    console.warn('Push registration skipped:', error?.message || error);
  }
}

function AuthGate({ onSession }) {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState('login');
  const [role, setRole] = useState('customer');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const defaultApiBaseInput = getApiBaseUrl().replace(/\/api\/?$/, '');
  const [apiBaseInput, setApiBaseInput] = useState(defaultApiBaseInput);
  const [showServerSettings, setShowServerSettings] = useState(false);
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
      setSubmitting(true);
      setError('');
      setFieldErrors({});
      setRuntimeApiBaseUrl(apiBaseInput);
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
        ? { email: form.email.trim().toLowerCase(), password: form.password }
        : role === 'driver'
          ? {
              fullName: form.fullName.trim(),
              email: form.email.trim().toLowerCase(),
              phone: form.phone.trim(),
              password: form.password,
              licenseNumber: form.licenseNumber.trim(),
              emergencyContactName: form.emergencyContactName.trim(),
              emergencyContactPhone: form.emergencyContactPhone.trim(),
              registrationNumber: form.registrationNumber.trim(),
              vehicleType: (form.vehicleType || 'motorbike').toLowerCase(),
              vehicleMake: form.vehicleMake || null,
              vehicleModel: form.vehicleModel || null,
              vehicleColor: form.vehicleColor || null,
            }
          : role === 'restaurant'
            ? {
                ownerFullName: (form.ownerFullName || form.fullName).trim(),
                email: form.email.trim().toLowerCase(),
                phone: form.phone.trim(),
                password: form.password,
                legalName: form.legalName.trim(),
                displayName: form.displayName.trim(),
                supportEmail: (form.supportEmail || form.email).trim().toLowerCase(),
                supportPhone: (form.supportPhone || form.phone).trim(),
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
            : { fullName: form.fullName.trim(), email: form.email.trim().toLowerCase(), phone: form.phone.trim(), password: form.password, preferredLanguage: 'en', marketingOptIn: true };
      const session = await api(path, { method: 'POST', body: JSON.stringify(body) });
      if (mode === 'register' && (role === 'driver' || role === 'restaurant') && !session?.token) {
        Alert.alert('Application submitted', role === 'driver' ? 'Your driver application has been submitted for admin approval.' : 'Your restaurant application has been submitted for admin approval.');
        setMode('login');
        setRole('customer');
        return;
      }
      onSession(session);
    } catch (err) {
      const message = String(err?.message || err);
      const readable = /network request failed|failed to fetch|load failed/i.test(message)
        ? `Could not reach the server at ${getApiBaseUrl()}. Enter your laptop address such as http://192.168.170.137:4000, keep the phone and laptop on the same Wi-Fi, and make sure the backend is running on port 4000.`
        : /invalid credentials|unauthorized|invalid email or password/i.test(message)
          ? 'Incorrect email or password.'
          : /data/i.test(message) && mode === 'login'
            ? 'Sign in failed. Please check your email and password.'
            : message;
      setError(readable);
      Alert.alert(mode === 'login' ? 'Sign in failed' : 'Registration failed', readable);
    } finally {
      setSubmitting(false);
    }
  };

  const topSpacing = Math.max(insets.top, 12);
  const bottomSpacing = Math.max(insets.bottom, 16);

  return (
    <SafeAreaView edges={['top','bottom']} style={authStyles.screen()}>
      <StatusBar barStyle={getPalette().mode === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={getPalette().background} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={topSpacing}>
        <ScrollView contentContainerStyle={[authStyles.container, { paddingTop: topSpacing + 8, paddingBottom: bottomSpacing + 12 }]} keyboardShouldPersistTaps="handled">
          <View style={authStyles.card()}>
            <View style={{ alignItems: 'center', marginBottom: 10 }}>
              <Image source={LOGO} style={{ width: 92, height: 92, borderRadius: 24 }} resizeMode="contain" />
            </View>
            <Text style={{ color: '#ffcb45', textTransform: 'uppercase', letterSpacing: 1.4, marginBottom: 6, textAlign: 'center' }}>Food delivery mobile</Text>
            <Text style={{ color: '#fff7ef', fontSize: 28, fontWeight: '800', textAlign: 'center' }}>{mode === 'login' ? 'Welcome back' : 'Create account'}</Text>
            {!!error ? <Text style={{ color: '#ff8c8c', marginTop: 10, textAlign: 'center' }}>{error}</Text> : null}
            <View style={authStyles.segmentedRow}>
              <TouchableOpacity onPress={() => setMode('login')} style={[authStyles.segmentedBtn, { backgroundColor: mode === 'login' ? '#ff6b00' : 'rgba(255,255,255,0.08)' }]}><Text style={{ color: mode === 'login' ? '#2a1105' : '#fff7ef', textAlign: 'center', fontWeight: '700' }}>Login</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => setMode('register')} style={[authStyles.segmentedBtn, { backgroundColor: mode === 'register' ? '#ff6b00' : 'rgba(255,255,255,0.08)' }]}><Text style={{ color: mode === 'register' ? '#2a1105' : '#fff7ef', textAlign: 'center', fontWeight: '700' }}>Register</Text></TouchableOpacity>
            </View>
            <Pressable onPress={() => setShowServerSettings(true)} style={{ alignSelf: 'center', marginTop: 12, paddingHorizontal: 12, paddingVertical: 8 }}><Text style={{ color: '#d8bca7', fontWeight: '700' }}>Server settings</Text></Pressable>
            {mode === 'register' ? (
              <View style={[authStyles.segmentedRow, { marginTop: 10 }]}>
                <TouchableOpacity onPress={() => setRole('customer')} style={[authStyles.segmentedBtn, { backgroundColor: role === 'customer' ? '#ffcb45' : 'rgba(255,255,255,0.08)' }]}><Text style={{ color: '#2a1105', textAlign: 'center', fontWeight: '700' }}>Customer</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => { setRole('driver'); setForm((prev) => ({ ...prev, vehicleType: prev.vehicleType || 'motorbike' })); }} style={[authStyles.segmentedBtn, { backgroundColor: role === 'driver' ? '#ffcb45' : 'rgba(255,255,255,0.08)' }]}><Text style={{ color: '#2a1105', textAlign: 'center', fontWeight: '700' }}>Driver</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => setRole('restaurant')} style={[authStyles.segmentedBtn, { backgroundColor: role === 'restaurant' ? '#ffcb45' : 'rgba(255,255,255,0.08)' }]}><Text style={{ color: '#2a1105', textAlign: 'center', fontWeight: '700' }}>Restaurant</Text></TouchableOpacity>
              </View>
            ) : null}
            <ScrollView style={{ maxHeight: 460, marginTop: 6 }} keyboardShouldPersistTaps="handled">
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
            <Button title={mode === 'login' ? 'Sign in' : 'Continue'} onPress={submit} loading={submitting} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <Modal visible={showServerSettings} animationType="fade" transparent onRequestClose={() => setShowServerSettings(false)}>
        <View style={authStyles.modalBackdrop()}>
          <View style={authStyles.modalCard()}>
            <Text style={{ color: '#fff7ef', fontSize: 22, fontWeight: '800' }}>Server settings</Text>
            <Text style={{ color: '#f3c8a5', marginTop: 8, lineHeight: 22 }}>Use your laptop IP on the same Wi-Fi, for example http://192.168.170.137:4000.</Text>
            <Field value={apiBaseInput} onChangeText={setApiBaseInput} placeholder="Backend URL e.g. http://192.168.170.137:4000" autoCapitalize="none" />
            <Button title="Save server settings" onPress={() => { setRuntimeApiBaseUrl(apiBaseInput); setShowServerSettings(false); }} />
            <Button title="Close" secondary onPress={() => setShowServerSettings(false)} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}


function RestaurantTile({ item, onPress, compact = false }) {
  const logo = resolveAssetUrl(item.logo_url);
  const banner = resolveAssetUrl(item.banner_url);
  const cuisine = Array.isArray(item.cuisine_tags) ? item.cuisine_tags.filter(Boolean).slice(0, 3) : [];
  return (
    <Pressable onPress={() => onPress?.(item)} style={{ marginBottom: compact ? 0 : 2 }}>
      <View style={{
        backgroundColor: 'rgba(255,255,255,0.06)',
        borderRadius: 24,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
        marginBottom: compact ? 0 : 14,
      }}>
        <View style={{ position: 'relative' }}>
          <Image
            source={banner ? { uri: banner } : logo ? { uri: logo } : LOGO}
            style={{ width: '100%', height: compact ? 132 : 168, backgroundColor: 'rgba(255,255,255,0.06)' }}
            resizeMode="cover"
          />
          <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(18,7,2,0.30)' }} />
          <View style={{ position: 'absolute', top: 12, left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ backgroundColor: 'rgba(17,17,17,0.75)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 }}>
              <Text style={{ color: '#fff7ef', fontWeight: '800', fontSize: 12 }}>★ {Number(item.average_rating || 0).toFixed(1)}</Text>
            </View>
            <View style={{ backgroundColor: 'rgba(255,203,69,0.92)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 }}>
              <Text style={{ color: '#2a1105', fontWeight: '900', fontSize: 12 }}>{item.active_items || 0} items</Text>
            </View>
          </View>
          <View style={{ position: 'absolute', left: 14, bottom: 14, right: 14, flexDirection: 'row', alignItems: 'flex-end' }}>
            <Image source={logo ? { uri: logo } : LOGO} style={{ width: 58, height: 58, borderRadius: 18, backgroundColor: '#fff7ef', borderWidth: 2, borderColor: 'rgba(255,255,255,0.85)' }} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={{ color: '#fff7ef', fontSize: 18, fontWeight: '800' }} numberOfLines={1}>{item.display_name}</Text>
              <Text style={{ color: '#ffe1cc', marginTop: 2 }} numberOfLines={1}>{[item.city, item.province].filter(Boolean).join(', ') || 'Nearby'}</Text>
            </View>
            <View style={{ backgroundColor: 'rgba(17,17,17,0.76)', width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="chevron-forward" size={18} color="#ffcb45" />
            </View>
          </View>
        </View>
        <View style={{ padding: 14 }}>
          <Text style={{ color: '#f3c8a5', lineHeight: 19 }} numberOfLines={compact ? 2 : 3}>
            {item.description || 'Fresh meals, reliable delivery, and a cleaner browse-to-order experience.'}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 }}>
            {cuisine.length ? cuisine.map((tag) => (
              <View key={tag} style={{ backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, marginRight: 8, marginBottom: 8 }}>
                <Text style={{ color: '#fff7ef', fontSize: 12, fontWeight: '700' }}>{tag}</Text>
              </View>
            )) : (
              <>
                <View style={{ backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, marginRight: 8 }}>
                  <Text style={{ color: '#fff7ef', fontSize: 12, fontWeight: '700' }}>Fast delivery</Text>
                </View>
                <View style={{ backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
                  <Text style={{ color: '#fff7ef', fontSize: 12, fontWeight: '700' }}>Popular store</Text>
                </View>
              </>
            )}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name="time-outline" size={16} color="#ffcb45" />
              <Text style={{ color: '#fff7ef', marginLeft: 6, fontWeight: '700' }}>25-35 min</Text>
            </View>
            <Text style={{ color: '#ffcb45', fontWeight: '800' }}>Tap to open menu</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

function CustomerPromoSlide({ slide, onPress }) {
  const image = resolveAssetUrl(slide.image_url || slide.banner_image_url || slide.banner_url || slide.logo_url);
  const { width } = useWindowDimensions();
  const cardWidth = Math.max(278, Math.min(width - 54, width * 0.84));
  return (
    <Pressable onPress={onPress} style={{ width: cardWidth, marginRight: 14 }}>
      <View style={{ borderRadius: 26, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', minHeight: 190, backgroundColor: 'rgba(255,255,255,0.06)' }}>
        <Image source={image ? { uri: image } : LOGO} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} resizeMode="cover" />
        <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(18,7,2,0.38)' }} />
        <View style={{ padding: 18, justifyContent: 'space-between', flex: 1 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ backgroundColor: slide.kind === 'promotion' ? 'rgba(255,203,69,0.95)' : 'rgba(17,17,17,0.75)', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 }}>
              <Text style={{ color: slide.kind === 'promotion' ? '#2a1105' : '#fff7ef', fontWeight: '900', fontSize: 12 }}>{slide.kind === 'promotion' ? 'Promo' : 'Featured'}</Text>
            </View>
            <View style={{ backgroundColor: 'rgba(255,255,255,0.10)', width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="arrow-forward" size={18} color="#fff7ef" />
            </View>
          </View>
          <View style={{ marginTop: 46 }}>
            <Text style={{ color: '#fff7ef', fontWeight: '900', fontSize: 22 }} numberOfLines={2}>{slide.title}</Text>
            <Text style={{ color: '#ffe0cb', marginTop: 8, lineHeight: 20 }} numberOfLines={2}>{slide.subtitle}</Text>
            <Text style={{ color: '#ffcb45', marginTop: 12, fontWeight: '800' }} numberOfLines={1}>{slide.restaurantName}</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

function RestaurantMenuModal({ visible, onClose, token, restaurantId, onAddedToCart }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [addingId, setAddingId] = useState(null);

  useEffect(() => {
    if (!visible || !restaurantId) return;
    setLoading(true);
    api(`/customer/restaurants/${restaurantId}`, {}, token)
      .then(setData)
      .catch((e) => Alert.alert('Restaurant failed', e.message))
      .finally(() => setLoading(false));
  }, [visible, restaurantId, token]);

  const groupedItems = useMemo(() => {
    const categories = data?.categories || [];
    const items = data?.items || [];
    const map = new Map(categories.map((cat) => [cat.id, { ...cat, items: [] }]));
    items.forEach((item) => {
      const key = item.category_id;
      if (map.has(key)) map.get(key).items.push(item);
      else map.set(key, { id: key || `uncat-${item.id}`, name: 'Menu', description: '', items: [item] });
    });
    return Array.from(map.values()).filter((group) => (group.items || []).length > 0);
  }, [data]);

  const addToCart = async (menuItem) => {
    try {
      setAddingId(menuItem.id);
      await api('/customer/cart/items', {
        method: 'POST',
        body: JSON.stringify({ restaurantId, menuItemId: menuItem.id, quantity: 1 }),
      }, token);
      Alert.alert('Added to cart', `${menuItem.name} has been added to your cart.`);
      onAddedToCart?.();
    } catch (err) {
      Alert.alert('Add to cart failed', String(err.message || err));
    } finally {
      setAddingId(null);
    }
  };

  const banner = resolveAssetUrl(data?.restaurant?.banner_url);
  const logo = resolveAssetUrl(data?.restaurant?.logo_url);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView edges={['top','bottom']} style={{ flex: 1, backgroundColor: '#120702' }}>
        <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)', backgroundColor: 'rgba(18,7,2,0.96)' }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={{ color: '#fff7ef', fontSize: 22, fontWeight: '800' }} numberOfLines={2}>{data?.restaurant?.display_name || 'Restaurant menu'}</Text>
              <Text style={{ color: '#f3c8a5', marginTop: 6 }}>Browse items, add to cart, then use the floating button to get back to restaurants.</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12} style={{ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}><Ionicons name="close" size={22} color="#fff7ef" /></Pressable>
          </View>
        </View>
        <ScrollView style={{ flex: 1, paddingHorizontal: 16 }} contentContainerStyle={{ paddingTop: 16, paddingBottom: 120 }}>
          {loading ? <ActivityIndicator color="#ff6b00" style={{ marginTop: 30 }} /> : null}
          {!loading && data?.restaurant ? (
            <>
              <Card style={{ overflow: 'hidden' }}>
                {banner ? <Image source={{ uri: banner }} style={{ width: '100%', height: 140, borderRadius: 16, marginBottom: 12 }} resizeMode="cover" /> : null}
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Image source={logo ? { uri: logo } : LOGO} style={{ width: 62, height: 62, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.08)', marginRight: 12 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#fff7ef', fontSize: 20, fontWeight: '800' }}>{data.restaurant.display_name}</Text>
                    <Text style={{ color: '#f3c8a5', marginTop: 4 }}>{data.restaurant.city || 'Nearby'}{data.restaurant.province ? `, ${data.restaurant.province}` : ''}</Text>
                    <Text style={{ color: '#ffcb45', marginTop: 6 }}>★ {Number(data.restaurant.average_rating || 0).toFixed(1)}</Text>
                  </View>
                </View>
                {data.restaurant.description ? <Text style={{ color: '#f3c8a5', marginTop: 12, lineHeight: 20 }}>{data.restaurant.description}</Text> : null}
              </Card>
              {groupedItems.length === 0 ? <Card><Text style={{ color: '#f3c8a5' }}>No menu items are available right now.</Text></Card> : groupedItems.map((group) => (
                <View key={group.id || group.name}>
                  <SectionTitle eyebrow="Menu" title={group.name} subtitle={group.description || 'Tap any item to add it to your cart.'} />
                  {(group.items || []).map((menuItem) => (
                    <Card key={menuItem.id}>
                      <Text style={{ color: '#fff7ef', fontWeight: '800', fontSize: 18 }} numberOfLines={2}>{menuItem.name}</Text>
                      {menuItem.description ? <Text style={{ color: '#f3c8a5', marginTop: 6, lineHeight: 20 }}>{menuItem.description}</Text> : null}
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}>
                        {menuItem.is_vegetarian ? <Text style={{ color: '#ffcb45', marginRight: 10 }}>Vegetarian</Text> : null}
                        {menuItem.is_vegan ? <Text style={{ color: '#ffcb45', marginRight: 10 }}>Vegan</Text> : null}
                        {menuItem.is_halal ? <Text style={{ color: '#ffcb45', marginRight: 10 }}>Halal</Text> : null}
                      </View>
                      <Text style={{ color: '#fff7ef', marginTop: 10, fontWeight: '800' }}>R {Number(menuItem.base_price || 0).toFixed(2)}</Text>
                      <Button title={addingId === menuItem.id ? 'Adding...' : 'Add to cart'} onPress={() => addToCart(menuItem)} loading={addingId === menuItem.id} />
                    </Card>
                  ))}
                </View>
              ))}
            </>
          ) : null}
        </ScrollView>
        <Pressable
          onPress={onClose}
          hitSlop={12}
          style={({ pressed }) => ({
            position: 'absolute',
            right: 16,
            bottom: 20,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 16,
            paddingVertical: 12,
            borderRadius: 24,
            backgroundColor: pressed ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.18)',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.24)',
            shadowColor: '#000',
            shadowOpacity: 0.22,
            shadowRadius: 18,
            shadowOffset: { width: 0, height: 10 },
            elevation: 10,
          })}
        >
          <Ionicons name="arrow-back" size={18} color="#fff7ef" style={{ marginRight: 8 }} />
          <Text style={{ color: '#fff7ef', fontWeight: '800', fontSize: 15 }}>Close menu</Text>
        </Pressable>
      </SafeAreaView>
    </Modal>
  );
}


function CustomerHome({ token }) {
  const [data, setData] = useState(null);
  const [selectedRestaurantId, setSelectedRestaurantId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCuisine, setActiveCuisine] = useState('All');
  const load = () => api('/customer/home', {}, token).then(setData).catch((e) => Alert.alert('Load failed', e.message));
  useEffect(() => { load(); }, [token]);

  const restaurants = useMemo(() => {
    const featured = data?.featuredRestaurants || [];
    const regular = data?.restaurants || [];
    const merged = [...featured.map((item) => ({ ...item, id: item.restaurant_id || item.id })), ...regular];
    const seen = new Set();
    return merged.filter((item) => {
      const id = item.restaurant_id || item.id;
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    }).map((item) => ({ ...item, id: item.restaurant_id || item.id }));
  }, [data]);

  const cuisineTags = useMemo(() => {
    const tags = [];
    restaurants.forEach((item) => (item.cuisine_tags || []).forEach((tag) => { if (tag && !tags.includes(tag)) tags.push(tag); }));
    return ['All', ...tags.slice(0, 8)];
  }, [restaurants]);

  const filteredRestaurants = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return restaurants.filter((item) => {
      const cuisineMatch = activeCuisine === 'All' || (item.cuisine_tags || []).some((tag) => String(tag).toLowerCase() === activeCuisine.toLowerCase());
      if (!cuisineMatch) return false;
      if (!query) return true;
      const haystack = [item.display_name, item.description, item.city, item.province, ...(item.cuisine_tags || [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [restaurants, searchQuery, activeCuisine]);

  const featuredStores = useMemo(() => filteredRestaurants.slice(0, 6), [filteredRestaurants]);

  const sliderItems = useMemo(() => {
    const promos = data?.promotions || [];
    const baseRestaurants = featuredStores.length ? featuredStores : filteredRestaurants.length ? filteredRestaurants : restaurants;
    const promoSlides = promos.map((promo, index) => {
      const linkedRestaurant = baseRestaurants[index % Math.max(baseRestaurants.length, 1)] || null;
      return {
        key: `promo-${promo.id || index}`,
        kind: 'promotion',
        title: promo.title || 'Limited time promo',
        subtitle: promo.description || 'Tap to browse the linked restaurant menu.',
        image_url: promo.banner_image_url || linkedRestaurant?.banner_url || linkedRestaurant?.logo_url,
        restaurantId: linkedRestaurant?.id || linkedRestaurant?.restaurant_id || null,
        restaurantName: linkedRestaurant?.display_name || 'Featured restaurant',
      };
    });
    const restaurantSlides = featuredStores.map((item, index) => ({
      key: `restaurant-${item.id || item.restaurant_id || index}`,
      kind: 'restaurant',
      title: item.display_name,
      subtitle: item.description || 'Open menu, browse categories, and order quickly.',
      image_url: item.banner_url || item.logo_url,
      restaurantId: item.id || item.restaurant_id,
      restaurantName: item.display_name,
    }));
    return [...promoSlides, ...restaurantSlides].filter((item) => item.restaurantId);
  }, [data, featuredStores, filteredRestaurants, restaurants]);

  return (
    <>
      <SafeAreaView edges={['top']} style={shellStyle()}>
      <ScrollView style={shellStyle()} contentContainerStyle={{ padding: 16, paddingBottom: 34 }}>
        <SectionTitle eyebrow="Customer" title="Discover & order" subtitle="A cleaner browse experience with promo banners, featured stores, and faster restaurant entry." />
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <View style={{ padding: 18 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 }}>
              <Ionicons name="search" size={18} color="#ffcb45" />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search restaurants, burgers, pizza, chicken..."
                placeholderTextColor="#f3c8a5"
                style={{ color: '#fff7ef', marginLeft: 10, flex: 1, paddingVertical: 4 }}
              />
              {searchQuery ? (
                <Pressable onPress={() => setSearchQuery('')} hitSlop={10}>
                  <Ionicons name="close-circle" size={18} color="#fff7ef" />
                </Pressable>
              ) : <Ionicons name="options-outline" size={18} color="#fff7ef" />}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 14 }}>
              {cuisineTags.map((tag) => (
                <Pressable key={tag} onPress={() => setActiveCuisine(tag)} style={{ backgroundColor: tag === activeCuisine ? '#ffcb45' : 'rgba(255,255,255,0.08)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, marginRight: 8, marginBottom: 8 }}>
                  <Text style={{ color: tag === activeCuisine ? '#2a1105' : '#fff7ef', fontWeight: '800' }}>{tag}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </Card>

        <View style={{ marginTop: 6, marginBottom: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <Text style={{ color: '#fff7ef', fontSize: 21, fontWeight: '900' }}>Top promos & restaurants</Text>
            <Text style={{ color: '#ffcb45', fontWeight: '800' }}>Tap any slide</Text>
          </View>
          {!sliderItems.length ? <Card><Text style={{ color: '#f3c8a5' }}>No promos or featured stores are available right now.</Text></Card> : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} decelerationRate="fast" snapToAlignment="start" contentContainerStyle={{ paddingRight: 30 }}>
              {sliderItems.map((slide) => (
                <CustomerPromoSlide key={slide.key} slide={slide} onPress={() => setSelectedRestaurantId(slide.restaurantId)} />
              ))}
            </ScrollView>
          )}
        </View>

        {featuredStores.length ? (
          <View style={{ marginTop: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <Text style={{ color: '#fff7ef', fontSize: 21, fontWeight: '900' }}>Featured stores</Text>
              <Text style={{ color: '#f3c8a5' }}>{featuredStores.length} available</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 12 }}>
              {featuredStores.map((item) => (
                <View key={item.id} style={{ width: 286, marginRight: 14 }}>
                  <RestaurantTile item={item} compact onPress={() => setSelectedRestaurantId(item.id)} />
                </View>
              ))}
            </ScrollView>
          </View>
        ) : null}

        <View style={{ marginTop: 18 }}>
          <Text style={{ color: '#fff7ef', fontSize: 21, fontWeight: '900', marginBottom: 12 }}>All restaurants</Text>
          {!data ? <ActivityIndicator color="#ff6b00" /> : !filteredRestaurants.length ? <Card><Text style={{ color: '#f3c8a5' }}>No restaurants matched your search or selected filter.</Text></Card> : filteredRestaurants.map((item) => (
            <RestaurantTile key={item.id} item={item} onPress={() => setSelectedRestaurantId(item.id)} />
          ))}
        </View>
      </ScrollView>
      </SafeAreaView>
      <RestaurantMenuModal visible={!!selectedRestaurantId} token={token} restaurantId={selectedRestaurantId} onClose={() => setSelectedRestaurantId(null)} onAddedToCart={load} />
    </>
  );
}

function DealsScreen({ token }) {
  const [deals, setDeals] = useState([]);
  useEffect(() => { api('/customer/deals', {}, token).then((d) => setDeals(d.coupons || d.deals || [])).catch((e) => Alert.alert('Deals failed', e.message)); }, [token]);
  return (
    <SafeAreaView edges={['top']} style={shellStyle()}>
    <ScrollView style={shellStyle()} contentContainerStyle={{ padding: 16, paddingBottom: 24 }}>
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
    </SafeAreaView>
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
  const palette = getPalette();
  const [cart, setCart] = useState(null);
  const [addresses, setAddresses] = useState([]);
  const [paymentMethod, setPaymentMethod] = useState('card');
  const [cardNumber, setCardNumber] = useState('');
  const [bankReference, setBankReference] = useState('');
  const [selectedSavedCard, setSelectedSavedCard] = useState('');
  const [savedCards, setSavedCards] = useState([]);
  const [availableMethods, setAvailableMethods] = useState([]);
  const [addressId, setAddressId] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [cartData, addressData, methodData, savedCardData] = await Promise.all([
        api('/customer/cart', {}, token).catch(() => null),
        api('/customer/addresses', {}, token).catch(() => []),
        api('/payments/methods/available', {}, token).catch(() => ({ methods: [
          { code: 'card', label: 'Card' },
          { code: 'saved_card', label: 'Saved card' },
          { code: 'eft_bank_transfer', label: 'EFT / Bank transfer' },
          { code: 'cash_on_delivery', label: 'Cash on delivery' },
        ] })),
        api('/payments/methods/saved', {}, token).catch(() => []),
      ]);
      const normalizedAddresses = Array.isArray(addressData) ? addressData : (addressData?.addresses || []);
      const normalizedSavedCards = Array.isArray(savedCardData) ? savedCardData : (savedCardData?.paymentMethods || savedCardData?.cards || []);
      const normalizedMethods = methodData?.methods || [];
      setCart(cartData);
      setAddresses(normalizedAddresses);
      setAvailableMethods(normalizedMethods);
      setSavedCards(normalizedSavedCards);
      setAddressId((prev) => prev || normalizedAddresses.find((a) => a.is_default)?.id || normalizedAddresses[0]?.id || '');
      setSelectedSavedCard((prev) => prev || normalizedSavedCards.find((c) => c.is_default)?.id || normalizedSavedCards[0]?.id || '');
      if (!normalizedMethods.find((m) => m.code === paymentMethod)) {
        setPaymentMethod(normalizedMethods[0]?.code || 'card');
      }
    } catch (e) {
      Alert.alert('Cart failed', String(e.message || e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);
  useFocusEffect(
    React.useCallback(() => {
      load();
      return undefined;
    }, [token])
  );

  const selectedAddress = useMemo(() => addresses.find((a) => a.id === addressId) || null, [addresses, addressId]);
  const canCheckout = !!cart && !!cart.items?.length && !!addressId && !busy && (
    paymentMethod === 'cash_on_delivery' ||
    paymentMethod === 'eft_bank_transfer' ||
    (paymentMethod === 'saved_card' && !!selectedSavedCard) ||
    (paymentMethod === 'card' && cardNumber.replace(/\D/g, '').length >= 13)
  );

  const updateQuantity = async (itemId, quantity) => {
    try {
      if (quantity <= 0) {
        await api(`/customer/cart/items/${itemId}`, { method: 'DELETE' }, token);
      } else {
        await api(`/customer/cart/items/${itemId}`, { method: 'PATCH', body: JSON.stringify({ quantity }) }, token);
      }
      await load();
    } catch (e) {
      Alert.alert('Cart update failed', String(e.message || e));
    }
  };

  const checkout = async () => {
    if (!canCheckout) return;
    setBusy(true);
    try {
      const payload = {
        orderType: 'delivery',
        addressId,
        tipAmount: 0,
        paymentMethod,
        paymentMethodId: paymentMethod === 'saved_card' ? selectedSavedCard : null,
        bankTransferReference: paymentMethod === 'eft_bank_transfer' ? (bankReference || null) : null,
        demoCard: paymentMethod === 'card' ? {
          cardholderName: 'Demo Customer',
          cardNumberLast4: cardNumber.replace(/\D/g, '').slice(-4),
          expiryMonth: 12,
          expiryYear: new Date().getFullYear() + 2,
          brand: cardNumber.replace(/\D/g, '').startsWith('4') ? 'Visa' : 'Mastercard',
        } : null,
      };
      const order = await api('/customer/checkout', { method: 'POST', body: JSON.stringify(payload) }, token);
      Alert.alert('Order placed', `Payment status: ${order?.payment_status || 'processed'}`);
      setCardNumber('');
      setBankReference('');
      await load();
    } catch (e) {
      Alert.alert('Checkout failed', String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={shellStyle()}>
      <ScrollView style={shellStyle()} contentContainerStyle={{ padding: 16, paddingBottom: 30 }}>
        <SectionTitle eyebrow="Cart" title="Review your order" subtitle="Items added from restaurant menus now appear here so you can update quantities and place the order." />

        {loading ? <ActivityIndicator color={palette.primary} style={{ marginTop: 20 }} /> : null}

        {!loading && (!cart || !cart.items || !cart.items.length) ? (
          <Card>
            <Ionicons name="cart-outline" size={34} color={palette.warning} style={{ marginBottom: 10 }} />
            <Text style={{ color: palette.text, fontWeight: '800', fontSize: 18 }}>Your cart is empty</Text>
            <Text style={{ color: palette.textMuted, marginTop: 8, lineHeight: 20 }}>Add items from a restaurant menu, then come back here to finish checkout.</Text>
          </Card>
        ) : null}

        {cart?.items?.length ? (
          <>
            <Card>
              <Text style={{ color: palette.text, fontWeight: '900', fontSize: 20 }}>{cart.restaurant_name || 'Your cart'}</Text>
              <Text style={{ color: palette.textMuted, marginTop: 6 }}>{cart.items.length} item{cart.items.length === 1 ? '' : 's'} ready for checkout</Text>
              {cart.items.map((item) => (
                <View key={item.id} style={{ marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: palette.border }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <View style={{ flex: 1, paddingRight: 12 }}>
                      <Text style={{ color: palette.text, fontWeight: '800', fontSize: 16 }}>{item.item_name}</Text>
                      <Text style={{ color: palette.textMuted, marginTop: 6 }}>Line total: R {Number(item.line_total || 0).toFixed(2)}</Text>
                    </View>
                    <Text style={{ color: palette.text, fontWeight: '800' }}>Qty {item.quantity}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', marginTop: 10 }}>
                    <View style={{ flex: 1, marginRight: 8 }}>
                      <Button title="-" secondary small onPress={() => updateQuantity(item.id, Math.max(1, Number(item.quantity || 1) - 1))} />
                    </View>
                    <View style={{ flex: 1, marginRight: 8 }}>
                      <Button title="+" small onPress={() => updateQuantity(item.id, Number(item.quantity || 1) + 1)} />
                    </View>
                    <View style={{ flex: 2 }}>
                      <Button title="Remove" danger small onPress={() => updateQuantity(item.id, 0)} />
                    </View>
                  </View>
                </View>
              ))}
            </Card>

            <Card>
              <Text style={{ color: palette.text, fontWeight: '900', fontSize: 18 }}>Delivery address</Text>
              {!addresses.length ? (
                <Text style={{ color: palette.textMuted, marginTop: 10 }}>No saved addresses yet. Add an address with a map pin first.</Text>
              ) : (
                addresses.map((address) => {
                  const active = address.id === addressId;
                  return (
                    <Pressable key={address.id} onPress={() => setAddressId(address.id)} style={{ marginTop: 10, borderRadius: 18, padding: 14, borderWidth: 1, borderColor: active ? palette.primary : palette.border, backgroundColor: active ? (palette.mode === 'dark' ? 'rgba(255,107,0,0.16)' : '#fff1e8') : palette.card }}>
                      <Text style={{ color: active ? palette.text : palette.text, fontWeight: '800' }}>{address.label || 'Saved address'}</Text>
                      <Text style={{ color: palette.textMuted, marginTop: 6, lineHeight: 20 }}>{formatAddress(address)}</Text>
                    </Pressable>
                  );
                })
              )}
              {selectedAddress?.latitude != null && selectedAddress?.longitude != null ? (
                <View style={{ marginTop: 12, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: palette.border }}>
                  <MapView style={{ width: '100%', height: 180 }} initialRegion={createRegion(selectedAddress.latitude, selectedAddress.longitude, 0.01, 0.01)}>
                    <Marker coordinate={{ latitude: Number(selectedAddress.latitude), longitude: Number(selectedAddress.longitude) }} title={selectedAddress.label || 'Delivery location'} />
                  </MapView>
                </View>
              ) : null}
            </Card>

            <Card>
              <Text style={{ color: palette.text, fontWeight: '900', fontSize: 18 }}>Payment method</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 }}>
                {(availableMethods.length ? availableMethods : [
                  { code: 'card', label: 'Card' },
                  { code: 'saved_card', label: 'Saved card' },
                  { code: 'eft_bank_transfer', label: 'EFT / Bank transfer' },
                  { code: 'cash_on_delivery', label: 'Cash on delivery' },
                ]).map((method) => (
                  <PaymentOptionChip key={method.code} selected={paymentMethod === method.code} label={method.label || method.code} onPress={() => setPaymentMethod(method.code)} />
                ))}
              </View>
              {paymentMethod === 'card' ? <Field value={cardNumber} onChangeText={setCardNumber} placeholder="Card number" keyboardType="number-pad" /> : null}
              {paymentMethod === 'saved_card' ? (
                <>
                  {savedCards.length === 0 ? <Text style={{ color: palette.textMuted, marginTop: 8 }}>No saved cards available.</Text> : savedCards.map((card) => (
                    <Pressable key={card.id} onPress={() => setSelectedSavedCard(card.id)} style={{ backgroundColor: selectedSavedCard === card.id ? palette.warning : palette.card, padding: 12, borderRadius: 16, marginTop: 10, borderWidth: 1, borderColor: palette.border }}>
                      <Text style={{ color: selectedSavedCard === card.id ? '#2a1105' : palette.text, fontWeight: '700' }}>{card.brand || 'Card'} •••• {card.last4 || '0000'}</Text>
                    </Pressable>
                  ))}
                </>
              ) : null}
              {paymentMethod === 'eft_bank_transfer' ? <Field value={bankReference} onChangeText={setBankReference} placeholder="Bank transfer reference" /> : null}
              {paymentMethod === 'cash_on_delivery' ? <Text style={{ color: palette.textMuted, marginTop: 10 }}>Pay the driver when your order arrives.</Text> : null}
            </Card>

            <Card>
              <Text style={{ color: palette.text, fontWeight: '800' }}>Subtotal: R {Number(cart.subtotal_amount || 0).toFixed(2)}</Text>
              <Text style={{ color: palette.text, fontWeight: '800', marginTop: 6 }}>Delivery: R {Number(cart.delivery_fee_amount || 0).toFixed(2)}</Text>
              <Text style={{ color: palette.text, fontWeight: '800', marginTop: 6 }}>Tax: R {Number(cart.tax_amount || 0).toFixed(2)}</Text>
              <Text style={{ color: palette.primary, fontWeight: '900', fontSize: 20, marginTop: 12 }}>Total: R {Number(cart.total_amount || 0).toFixed(2)}</Text>
              <Button title={busy ? 'Placing order...' : 'Place order'} onPress={checkout} loading={busy} disabled={!canCheckout} icon="checkmark-circle" />
            </Card>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function CustomerOrders({ token }) {
  const [orders, setOrders] = useState([]);
  const [cancelReason, setCancelReason] = useState('Ordered by mistake');
  const load = () => api('/customer/orders', {}, token).then(setOrders).catch((e) => Alert.alert('Orders failed', e.message));
  useEffect(() => {
    load();
    const socket = io(getSocketBaseUrl(), { transports: ['websocket', 'polling'], auth: { token } });
    const refresh = () => load();
    socket.on('order:status_changed', refresh);
    socket.on('delivery:accepted', refresh);
    socket.on('delivery:dispatch_ready', refresh);
    const intervalId = setInterval(refresh, 10000);
    return () => {
      clearInterval(intervalId);
      socket.disconnect();
    };
  }, [token]);
  return (
    <SafeAreaView edges={['top']} style={shellStyle()}>
    <ScrollView style={shellStyle()} contentContainerStyle={{ padding: 16, paddingBottom: 24 }}>
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
    </SafeAreaView>
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
      let reverse = null;
      try {
        reverse = (await Location.reverseGeocodeAsync({ latitude: current.coords.latitude, longitude: current.coords.longitude }))?.[0] || null;
      } catch (_) {
        reverse = null;
      }
      setForm((prev) => ({
        ...prev,
        latitude: String(current.coords.latitude),
        longitude: String(current.coords.longitude),
        addressLine1: prev.addressLine1 || reverse?.street || reverse?.name || 'Pinned location',
        addressLine2: prev.addressLine2 || reverse?.district || '',
        suburb: prev.suburb || reverse?.subregion || reverse?.district || '',
        city: prev.city || reverse?.city || reverse?.subregion || 'Current location',
        province: prev.province || reverse?.region || 'GP',
        postalCode: prev.postalCode || reverse?.postalCode || '',
      }));
      setMapVisible(true);
    } catch (err) {
      Alert.alert('Location unavailable', String(err.message || err));
    }
  };

  const saveAddress = async () => {
    try {
      setSaving(true);
      const hasPin = !!form.latitude && !!form.longitude;
      const payload = {
        label: form.label,
        addressLine1: form.addressLine1 || (hasPin ? 'Pinned location' : ''),
        addressLine2: form.addressLine2,
        locationLabel: form.suburb,
        city: form.city || (hasPin ? 'Current location' : ''),
        province: form.province || (hasPin ? 'GP' : ''),
        postalCode: form.postalCode,
        latitude: form.latitude ? Number(form.latitude) : null,
        longitude: form.longitude ? Number(form.longitude) : null,
        deliveryInstructions: form.deliveryInstructions,
        isDefault: true,
      };
      if (!hasPin && !payload.addressLine1.trim()) throw new Error('Use current location or enter an address before saving.');
      await api('/customer/addresses', {
        method: 'POST',
        body: JSON.stringify(payload),
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
    <SafeAreaView edges={['top']} style={shellStyle()}>
    <ScrollView style={shellStyle()} contentContainerStyle={{ padding: 16, paddingBottom: 24 }}>
      <SectionTitle eyebrow="Addresses" title="Delivery location" subtitle="Use your current location, pick an exact pin, and add delivery instructions." />
      <Card>
        <Button title="Use my current location" icon="locate" onPress={useCurrentLocation} />
        <Button title="Open map" icon="map-outline" secondary onPress={() => setMapVisible(true)} />
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
        <SafeAreaView edges={['top','bottom']} style={{ flex: 1, backgroundColor: '#120702' }}>
          <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' }}>
            <Text style={{ color: '#fff7ef', fontSize: 22, fontWeight: '800' }}>Pick exact delivery pin</Text>
            <Text style={{ color: '#f3c8a5', marginTop: 6 }}>Tap anywhere on the map to set the delivery location. Once you use live/current location, you do not need to fill in the street address manually.</Text>
          </View>
          <MapView style={{ flex: 1 }} initialRegion={region} region={region} onPress={(e) => {
            const { latitude, longitude } = e.nativeEvent.coordinate;
            setRegion((prev) => ({ ...prev, latitude, longitude }));
            setForm((prev) => ({ ...prev, latitude: String(latitude), longitude: String(longitude), addressLine1: prev.addressLine1 || 'Pinned location', city: prev.city || 'Pinned location', province: prev.province || 'GP' }));
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
    </SafeAreaView>
  );
}

function ProfileScreen({ token, session, onSessionChange, onLogout, themeMode, onToggleTheme }) {
  const palette = getPalette();
  const [form, setForm] = useState({ fullName: session.user.fullName || '', phone: session.user.phone || '', password: '' });
  const [summary, setSummary] = useState(null);
  const [loyaltyPoints, setLoyaltyPoints] = useState(0);
  const payoutRole = session.user.roles?.includes('driver') ? 'driver' : (session.user.roles?.includes('restaurant_owner') || session.user.roles?.includes('restaurant_manager')) ? 'restaurant' : null;
  const [account, setAccount] = useState({ holderScope: payoutRole || 'driver', accountName: '', bankName: '', accountNumber: '', branchCode: '', accountType: '' });
  useEffect(() => {
    if (payoutRole) api('/payouts/summary', {}, token).then(setSummary).catch(() => undefined);
    if (session.user.roles?.includes('customer')) {
      api('/customer/home', {}, token).then((data) => setLoyaltyPoints(Number(data?.loyalty?.loyalty_points || 0))).catch(() => undefined);
    }
  }, [token, session.user.roles]);
  const save = async () => {
    try {
      const data = await api('/auth/profile', { method: 'PUT', body: JSON.stringify({ fullName: form.fullName, phone: form.phone, password: form.password || undefined }) }, token);
      onSessionChange({ ...session, user: { ...session.user, ...data.user } });
      Alert.alert('Saved', 'Profile updated successfully.');
    } catch (err) {
      Alert.alert('Update failed', String(err.message || err));
    }
  };
  const savePayoutAccount = async () => {
    try {
      if (!payoutRole) return;
      await api('/payouts/bank-accounts', { method: 'POST', body: JSON.stringify({ ...account, holderScope: payoutRole }) }, token);
      Alert.alert('Saved', 'Payout account saved.');
    } catch (err) {
      Alert.alert('Save failed', String(err.message || err));
    }
  };
  return (
    <SafeAreaView edges={['top']} style={shellStyle()}>
    <ScrollView style={shellStyle()} contentContainerStyle={{ padding: 16, paddingBottom: 24 }}>
      <SectionTitle eyebrow="Profile" title={`Welcome, ${session.user.fullName || 'there'}`} subtitle="Update your details and view loyalty points. Payout tools only appear for drivers and restaurants." right={<Pressable onPress={onToggleTheme} style={{ backgroundColor: palette.surfaceSoft, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 14, borderWidth: 1, borderColor: palette.border }}><Text style={{ color: palette.text, fontWeight: '800' }}>{themeMode === 'dark' ? 'Light mode' : 'Dark mode'}</Text></Pressable>} />
      <Card>
        <Field value={form.fullName} onChangeText={(v) => setForm({ ...form, fullName: v })} placeholder="Full name" autoCapitalize="words" />
        <Field value={form.phone} onChangeText={(v) => setForm({ ...form, phone: v })} placeholder="Phone with country code" keyboardType="phone-pad" />
        <Field value={form.password} onChangeText={(v) => setForm({ ...form, password: v })} placeholder="New password" secureTextEntry />
        <Button title="Save profile" icon="save-outline" onPress={save} />
      </Card>
      <Card>
        <Text style={{ color: '#f3c8a5' }}>Loyalty points</Text>
        <Text style={{ color: '#fff7ef', fontSize: 28, fontWeight: '800', marginTop: 6 }}>{loyaltyPoints}</Text>
      </Card>
      {summary?.driver ? <Card><Text style={{ color: '#fff7ef', fontWeight: '700' }}>Driver wallet</Text><Text style={{ color: '#f3c8a5', marginTop: 8 }}>Available balance: {summary.driver.available_balance}</Text></Card> : null}
      {summary?.restaurant ? <Card><Text style={{ color: '#fff7ef', fontWeight: '700' }}>Restaurant wallet</Text><Text style={{ color: '#f3c8a5', marginTop: 8 }}>Available balance: {summary.restaurant.available_balance}</Text><Text style={{ color: '#f3c8a5', marginTop: 4 }}>Commission: {summary.restaurant.applied_commission_rate}%</Text></Card> : null}
      {payoutRole ? <Card>
        <Text style={{ color: '#fff7ef', fontWeight: '700' }}>Payout account</Text>
        <Field value={account.accountName} onChangeText={(v) => setAccount({ ...account, accountName: v })} placeholder="Payout account name" autoCapitalize="words" />
        <Field value={account.bankName} onChangeText={(v) => setAccount({ ...account, bankName: v })} placeholder="Bank name" autoCapitalize="words" />
        <Field value={account.accountNumber} onChangeText={(v) => setAccount({ ...account, accountNumber: v })} placeholder="Account number" keyboardType="number-pad" />
        <Field value={account.branchCode} onChangeText={(v) => setAccount({ ...account, branchCode: v })} placeholder="Branch code" keyboardType="number-pad" />
        <Field value={account.accountType} onChangeText={(v) => setAccount({ ...account, accountType: v })} placeholder="Account type" autoCapitalize="words" />
        <Button title="Save payout account" secondary onPress={savePayoutAccount} />
      </Card> : null}
      <Button title="Sign out" icon="log-out-outline" danger onPress={onLogout} />
    </ScrollView>
    </SafeAreaView>
  );
}

function DriverMapModal({ visible, onClose, data, target, onRefresh }) {
  const targetPoint = target === 'customer'
    ? (data?.dropoff_latitude != null && data?.dropoff_longitude != null ? { latitude: Number(data.dropoff_latitude), longitude: Number(data.dropoff_longitude) } : null)
    : (data?.restaurant_latitude != null && data?.restaurant_longitude != null ? { latitude: Number(data.restaurant_latitude), longitude: Number(data.restaurant_longitude) } : null);
  const driverPoint = data?.latestLocation?.latitude != null && data?.latestLocation?.longitude != null
    ? { latitude: Number(data.latestLocation.latitude), longitude: Number(data.latestLocation.longitude) }
    : null;
  const region = createRegion(targetPoint?.latitude || driverPoint?.latitude, targetPoint?.longitude || driverPoint?.longitude, 0.02, 0.02);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView edges={['top','bottom']} style={{ flex: 1, backgroundColor: '#120702' }}>
        <View style={{ padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ color: '#fff7ef', fontSize: 22, fontWeight: '800', flex: 1 }}>{target === 'customer' ? 'Customer navigation' : 'Restaurant navigation'}</Text>
          <Pressable onPress={onClose} style={{ padding: 6 }}><Ionicons name="close" size={24} color="#fff7ef" /></Pressable>
        </View>
        <MapView style={{ flex: 1 }} initialRegion={region} region={region} mapType="standard">
          {driverPoint ? <Marker coordinate={driverPoint} title="Driver" /> : null}
          {targetPoint ? <Marker coordinate={targetPoint} title={target === 'customer' ? 'Customer' : 'Restaurant'} /> : null}
        </MapView>
        <View style={{ padding: 16 }}>
          <Text style={{ color: '#f3c8a5', marginBottom: 8 }}>{target === 'customer' ? formatAddress(data || {}) || 'Customer drop-off location' : 'Restaurant pickup location'}</Text>
          <Button title="Refresh live map" onPress={onRefresh} />
          <Button title="Close map" secondary onPress={onClose} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}



function RestaurantOrdersScreen({ token, session, onLogout, onSessionChange, themeMode, onToggleTheme }) {
  const restaurantId = session?.user?.restaurantIds?.[0] || '';
  const [orders, setOrders] = useState([]);
  const [reasonByOrder, setReasonByOrder] = useState({});
  const [prepEtaByOrder, setPrepEtaByOrder] = useState({});
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!token || !restaurantId) return;
    setLoading(true);
    try {
      const data = await api(`/restaurants/${restaurantId}/orders`, {}, token);
      setOrders(data || []);
    } catch (err) {
      Alert.alert('Orders failed', String(err.message || err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    if (!token) return undefined;
    const socket = io(getSocketBaseUrl(), { transports: ['websocket', 'polling'], auth: { token } });
    socket.on('order:created', () => load());
    socket.on('order:status_changed', () => load());
    socket.on('delivery:accepted', () => load());
    socket.on('delivery:dispatch_ready', () => load());
    return () => socket.disconnect();
  }, [token, restaurantId]);

  const updateOrderStatus = async (orderId, status) => {
    try {
      await api(`/restaurants/${restaurantId}/orders/${orderId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({
          status,
          reason: reasonByOrder[orderId] || null,
          estimatedPrepMins: prepEtaByOrder[orderId] ? Number(prepEtaByOrder[orderId]) : null,
        }),
      }, token);
      await load();
    } catch (err) {
      Alert.alert('Update failed', String(err.message || err));
    }
  };

  return (
    <SafeAreaView edges={['top']} style={shellStyle()}>
      <ScrollView style={shellStyle()} contentContainerStyle={{ padding: 16, paddingBottom: 24 }}>
        <SectionTitle eyebrow="Restaurant" title="Order board" subtitle="New customer orders appear here. Accept an order to release it to drivers for delivery." right={<Pressable onPress={onToggleTheme} style={{ backgroundColor: getPalette().surfaceSoft, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 14, borderWidth: 1, borderColor: getPalette().border }}><Text style={{ color: getPalette().text, fontWeight: '800' }}>{themeMode === 'dark' ? 'Light mode' : 'Dark mode'}</Text></Pressable>} />
        {!restaurantId ? <Card><Text style={{ color: '#f3c8a5' }}>This account is not linked to a restaurant yet.</Text></Card> : null}
        {loading ? <ActivityIndicator color="#ff6b00" /> : null}
        {restaurantId && !loading && !orders.length ? <Card><Text style={{ color: '#f3c8a5' }}>No orders yet. New customer orders will appear here automatically.</Text></Card> : null}
        {orders.map((item) => (
          <Card key={item.id}>
            <Text style={{ color: '#fff7ef', fontWeight: '800', fontSize: 18 }}>{item.customer_name || 'Customer order'}</Text>
            <Text style={{ color: '#f3c8a5', marginTop: 6 }}>Order #{String(item.id).slice(0, 8)} · {item.order_type}</Text>
            <Text style={{ color: '#fff7ef', marginTop: 6 }}>Status: {item.status}</Text>
            <Text style={{ color: '#f3c8a5', marginTop: 4 }}>Placed: {new Date(item.placed_at).toLocaleString()}</Text>
            <Text style={{ color: '#fff7ef', marginTop: 6 }}>Total: {item.total_amount} {item.currency || 'ZAR'}</Text>
            <Field value={prepEtaByOrder[item.id] || ''} onChangeText={(v) => setPrepEtaByOrder((prev) => ({ ...prev, [item.id]: v }))} placeholder="Prep ETA mins" keyboardType="number-pad" />
            <Field value={reasonByOrder[item.id] || ''} onChangeText={(v) => setReasonByOrder((prev) => ({ ...prev, [item.id]: v }))} placeholder="Reason for reject or delay" autoCapitalize="sentences" />
            <Button title="Accept order" onPress={() => updateOrderStatus(item.id, 'confirmed')} />
            <Button title="Preparing" secondary onPress={() => updateOrderStatus(item.id, 'preparing')} />
            <Button title="Ready for pickup" secondary onPress={() => updateOrderStatus(item.id, 'ready_for_pickup')} />
            <Button title="Reject order" danger onPress={() => updateOrderStatus(item.id, 'cancelled')} />
          </Card>
        ))}
        <ProfileScreen token={token} session={session} onSessionChange={onSessionChange} onLogout={onLogout} themeMode={themeMode} onToggleTheme={onToggleTheme} />
      </ScrollView>
    </SafeAreaView>
  );
}

function DriverDeliveriesScreen(props) {
  return <DriverHub {...props} forcedTab="deliveries" />;
}
function DriverTrackingScreen(props) {
  return <DriverHub {...props} forcedTab="tracking" />;
}
function DriverProfileScreen(props) {
  return <ProfileScreen {...props} />;
}

function DriverHub({ token, user, onLogout, session, onSessionChange, forcedTab, themeMode, onToggleTheme }) {
  const [deliveries, setDeliveries] = useState([]);
  const [trackingState, setTrackingState] = useState('idle');
  const [payoutByDelivery, setPayoutByDelivery] = useState({});
  const [activeTab, setActiveTab] = useState(forcedTab || 'deliveries');
  useEffect(() => { if (forcedTab) setActiveTab(forcedTab); }, [forcedTab]);
  const [selectedDelivery, setSelectedDelivery] = useState(null);
  const [mapTarget, setMapTarget] = useState(null);
  const [mapData, setMapData] = useState(null);
  const load = () => api('/driver/deliveries', {}, token).then((rows) => { setDeliveries(rows); if (!selectedDelivery && rows.find((row) => row.is_mine)) setSelectedDelivery(rows.find((row) => row.is_mine)?.id || null); }).catch((e) => Alert.alert('Deliveries failed', e.message));
  useEffect(() => {
    load();
    const socket = io(getSocketBaseUrl(), { transports: ['websocket', 'polling'], auth: { token } });
    const refresh = () => load();
    socket.on('order:status_changed', refresh);
    socket.on('delivery:accepted', refresh);
    socket.on('delivery:dispatch_ready', refresh);
    const intervalId = setInterval(refresh, 10000);
    return () => {
      clearInterval(intervalId);
      socket.disconnect();
    };
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
  const mine = deliveries.filter((item) => item.is_mine);
  const activeDeliveryId = selectedDelivery || mine[0]?.id || null;
  const activeDelivery = mine.find((item) => item.id === activeDeliveryId) || mine[0] || null;
  const openMap = async (deliveryId, target) => {
    try {
      const live = await api(`/driver/deliveries/${deliveryId}/live`, {}, token);
      setMapData(live);
      setMapTarget(target);
    } catch (error) {
      Alert.alert('Map unavailable', String(error.message || error));
    }
  };
  const updateDeliveryStatus = async (deliveryId, status) => {
    try {
      await api(`/driver/deliveries/${deliveryId}/status`, { method: 'POST', body: JSON.stringify({ status }) }, token);
      await load();
    } catch (error) {
      Alert.alert('Status update failed', String(error.message || error));
    }
  };
  const tabButton = (key, label, icon) => (
    <Pressable key={key} onPress={() => setActiveTab(key)} style={{ width: '48%', backgroundColor: activeTab === key ? '#ff6b00' : 'rgba(255,255,255,0.08)', borderRadius: 16, paddingVertical: 12, paddingHorizontal: 10, alignItems: 'center', marginBottom: 10 }}>
      <Ionicons name={icon} size={20} color={activeTab === key ? '#2a1105' : '#fff7ef'} />
      <Text style={{ color: activeTab === key ? '#2a1105' : '#fff7ef', fontWeight: '800', marginTop: 6, fontSize: 12, textAlign: 'center' }}>{label}</Text>
    </Pressable>
  );
  return (
    <SafeAreaView edges={['top']} style={shellStyle()}>
    <ScrollView style={shellStyle()} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <SectionTitle eyebrow="Driver" title="Driver workspace" subtitle="All driver actions are available here with clear navigation and in-app maps." />
      {!forcedTab ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 14 }}>{[tabButton('deliveries', 'Deliveries', 'cube-outline'), tabButton('tracking', 'Tracking', 'navigate-outline'), tabButton('earnings', 'Earnings', 'wallet-outline'), tabButton('profile', 'Profile', 'person-outline')]}</View> : null}
      {activeTab === 'deliveries' ? <>
        <Card>
          <Text style={{ color: '#fff7ef', fontWeight: '800', fontSize: 18 }}>{user.fullName}</Text>
          <Text style={{ color: '#f3c8a5', marginTop: 6 }}>Available jobs and accepted deliveries are both visible below.</Text>
        </Card>
        {deliveries.map((item) => (
          <Card key={item.id}>
            <Text style={{ color: '#fff7ef', fontWeight: '800', fontSize: 18 }}>{item.restaurant_name}</Text>
            <Text style={{ color: '#ffcb45', marginTop: 6, fontWeight: '700' }}>{String(item.status || '').replace(/_/g, ' ')}</Text>
            <Text style={{ color: '#fff7ef', marginTop: 8, fontWeight: '700' }}>{item.customer_name || 'Customer'}{item.customer_phone ? ` · ${item.customer_phone}` : ''}</Text>
            <Text style={{ color: '#f3c8a5', marginTop: 6, lineHeight: 20 }}>{formatAddress(item) || 'Address pending'}</Text>
            {item.special_instructions ? <Text style={{ color: '#f3c8a5', marginTop: 6, lineHeight: 20 }}>Order note: {item.special_instructions}</Text> : null}
            {item.delivery_instructions ? <Text style={{ color: '#f3c8a5', marginTop: 6, lineHeight: 20 }}>Delivery note: {item.delivery_instructions}</Text> : null}
            <Text style={{ color: '#fff7ef', marginTop: 8 }}>Payout: {item.driver_payout_estimate}</Text>
            <Text style={{ color: '#f3c8a5', marginTop: 4 }}>Order total: {item.total_amount}</Text>
            {!item.is_mine ? <>
              <Field value={payoutByDelivery[item.id] || ''} onChangeText={(v) => setPayoutByDelivery((prev) => ({ ...prev, [item.id]: v }))} placeholder="Your delivery amount" keyboardType="numeric" />
              <Button title="Accept delivery" onPress={async () => { await api(`/driver/deliveries/${item.id}/accept`, { method: 'POST', body: JSON.stringify({ requestedPayout: payoutByDelivery[item.id] ? Number(payoutByDelivery[item.id]) : undefined }) }, token); setSelectedDelivery(item.id); load(); setActiveTab('tracking'); }} />
            </> : <>
              <Button title="Track this delivery" secondary onPress={() => { setSelectedDelivery(item.id); setActiveTab('tracking'); }} />
              <Button title="Navigate to restaurant" secondary onPress={() => openMap(item.id, 'restaurant')} />
              <Button title="Navigate to customer" secondary onPress={() => openMap(item.id, 'customer')} />
            </>}
          </Card>
        ))}
      </> : null}
      {activeTab === 'tracking' ? <>
        <Card>
          <Text style={{ color: '#fff7ef', fontWeight: '800', fontSize: 18 }}>Tracking</Text>
          <Text style={{ color: '#f3c8a5', marginTop: 6 }}>Tracking state: {trackingState}</Text>
          <Button title="Send live location" onPress={sendLocation} />
        </Card>
        {!mine.length ? <Card><Text style={{ color: '#f3c8a5' }}>Accept a delivery first to track restaurant and customer navigation.</Text></Card> : null}
        {mine.map((item) => (
          <Card key={item.id} style={activeDeliveryId === item.id ? { borderColor: '#ffcb45' } : null}>
            <Pressable onPress={() => setSelectedDelivery(item.id)}>
              <Text style={{ color: '#fff7ef', fontWeight: '800' }}>{item.restaurant_name}</Text>
              <Text style={{ color: '#f3c8a5', marginTop: 4 }}>{formatAddress(item) || 'Address pending'}</Text>
            </Pressable>
            {activeDeliveryId === item.id ? <>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 }}>
                {driverStatusActions.map((action) => (
                  <Pressable key={action.value} onPress={() => updateDeliveryStatus(item.id, action.value)} style={{ backgroundColor: 'rgba(255,255,255,0.08)', paddingVertical: 8, paddingHorizontal: 10, borderRadius: 999, marginRight: 8, marginBottom: 8 }}>
                    <Text style={{ color: '#fff7ef', fontWeight: '700', fontSize: 12 }}>{action.label}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={{ marginTop: 8 }}>
                {getDriverStatusSteps(item.status).map((step) => (
                  <View key={step.key} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                    <Ionicons name={step.done ? 'checkmark-circle' : step.active ? 'radio-button-on' : 'ellipse-outline'} size={18} color={step.done || step.active ? '#ffcb45' : '#d8bca7'} />
                    <Text style={{ color: step.done || step.active ? '#fff7ef' : '#d8bca7', marginLeft: 10, textTransform: 'capitalize' }}>{step.label}</Text>
                  </View>
                ))}
              </View>
              <Button title="Open restaurant map" secondary onPress={() => openMap(item.id, 'restaurant')} />
              <Button title="Open customer map" secondary onPress={() => openMap(item.id, 'customer')} />
            </> : null}
          </Card>
        ))}
      </> : null}
      {activeTab === 'earnings' ? <DriverEarnings token={token} /> : null}
      {activeTab === 'profile' ? <ProfileScreen token={token} session={session} onSessionChange={onSessionChange} onLogout={onLogout} themeMode={themeMode} onToggleTheme={onToggleTheme} /> : null}
      <DriverMapModal visible={!!mapTarget} onClose={() => { setMapTarget(null); setMapData(null); }} data={mapData} target={mapTarget} onRefresh={async () => { if (activeDeliveryId) { const live = await api(`/driver/deliveries/${activeDeliveryId}/live`, {}, token); setMapData(live); } }} />
    </ScrollView>
    </SafeAreaView>
  );
}

function DriverEarnings({ token }) {
  const [rows, setRows] = useState([]);
  useEffect(() => { api('/driver/earnings', {}, token).then(setRows).catch(() => undefined); }, [token]);
  return rows.length ? rows.map((row) => (
    <Card key={row.id}><Text style={{ color: '#fff7ef', fontWeight: '800' }}>{row.restaurant_name}</Text><Text style={{ color: '#f3c8a5', marginTop: 6 }}>{row.status}</Text><Text style={{ color: '#fff7ef', marginTop: 6 }}>Payout: {row.driver_payout_estimate}</Text></Card>
  )) : <Card><Text style={{ color: '#f3c8a5' }}>No earnings yet.</Text></Card>;
}

export default function App() {
  const [session, setSession] = useState(null);
  const [themeMode, setThemeMode] = useState(runtimeThemeMode);

  useEffect(() => {
    setRuntimeThemeMode(themeMode);
  }, [themeMode]);

  const role = useMemo(() => {
    if (session?.user?.roles?.includes('driver')) return 'driver';
    if (session?.user?.roles?.some((r) => ['restaurant_owner', 'restaurant_manager', 'restaurant_staff'].includes(r))) return 'restaurant';
    return 'customer';
  }, [session]);

  useEffect(() => {
    if (session?.token) registerForPush(session.token).catch(() => undefined);
  }, [session?.token]);

  const logout = () => setSession(null);
  const palette = getPalette();
  const navigationTheme = buildNavigationTheme();
  const toggleTheme = () => setThemeMode((prev) => (prev === 'dark' ? 'light' : 'dark'));

  const screenOptions = ({ route }) => ({
    headerShown: false,
    tabBarStyle: {
      backgroundColor: palette.surfaceSoft,
      borderTopColor: palette.border,
      height: 76,
      paddingBottom: 10,
      paddingTop: 10,
      borderTopWidth: 1,
    },
    tabBarActiveTintColor: palette.primary,
    tabBarInactiveTintColor: palette.textMuted,
    tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
    tabBarIcon: ({ color, size }) => {
      const icons = {
        Discover: 'restaurant-outline',
        Deals: 'pricetags-outline',
        Cart: 'cart-outline',
        Orders: 'receipt-outline',
        Addresses: 'location-outline',
        Profile: 'person-outline',
        Deliveries: 'cube-outline',
        Tracking: 'navigate-outline',
        Earnings: 'wallet-outline',
        RestaurantOrders: 'receipt-outline',
        RestaurantProfile: 'person-outline',
        DriverHome: 'car-outline',
      };
      return <Ionicons name={icons[route.name] || 'grid-outline'} size={size} color={color} />;
    },
  });

  return (
    <SafeAreaProvider>
      <StatusBar
        translucent={false}
        backgroundColor={palette.background}
        barStyle={palette.mode === 'dark' ? 'light-content' : 'dark-content'}
      />
      {!session ? (
        <AuthGate onSession={setSession} />
      ) : (
        <NavigationContainer theme={navigationTheme}>
          <Tab.Navigator screenOptions={screenOptions}>
            {role === 'driver' ? (
              <>
                <Tab.Screen name="Deliveries">
                  {() => (
                    <DriverDeliveriesScreen
                      token={session.token}
                      user={session.user}
                      onLogout={logout}
                      session={session}
                      onSessionChange={setSession}
                      themeMode={themeMode}
                      onToggleTheme={toggleTheme}
                    />
                  )}
                </Tab.Screen>
                <Tab.Screen name="Tracking">
                  {() => (
                    <DriverTrackingScreen
                      token={session.token}
                      user={session.user}
                      onLogout={logout}
                      session={session}
                      onSessionChange={setSession}
                      themeMode={themeMode}
                      onToggleTheme={toggleTheme}
                    />
                  )}
                </Tab.Screen>
                <Tab.Screen name="Earnings">{() => <DriverEarnings token={session.token} />}</Tab.Screen>
                <Tab.Screen name="Profile">
                  {() => (
                    <DriverProfileScreen
                      token={session.token}
                      session={session}
                      onSessionChange={setSession}
                      onLogout={logout}
                      themeMode={themeMode}
                      onToggleTheme={toggleTheme}
                    />
                  )}
                </Tab.Screen>
              </>
            ) : role === 'restaurant' ? (
              <>
                <Tab.Screen name="RestaurantOrders">
                  {() => (
                    <RestaurantOrdersScreen
                      token={session.token}
                      session={session}
                      onSessionChange={setSession}
                      onLogout={logout}
                      themeMode={themeMode}
                      onToggleTheme={toggleTheme}
                    />
                  )}
                </Tab.Screen>
                <Tab.Screen name="RestaurantProfile">
                  {() => (
                    <ProfileScreen
                      token={session.token}
                      session={session}
                      onSessionChange={setSession}
                      onLogout={logout}
                      themeMode={themeMode}
                      onToggleTheme={toggleTheme}
                    />
                  )}
                </Tab.Screen>
              </>
            ) : (
              <>
                <Tab.Screen name="Discover">{() => <CustomerHome token={session.token} />}</Tab.Screen>
                <Tab.Screen name="Deals">{() => <DealsScreen token={session.token} />}</Tab.Screen>
                <Tab.Screen name="Cart">{() => <CartScreen token={session.token} />}</Tab.Screen>
                <Tab.Screen name="Orders">{() => <CustomerOrders token={session.token} />}</Tab.Screen>
                <Tab.Screen name="Addresses">{() => <AddressesScreen token={session.token} />}</Tab.Screen>
                <Tab.Screen name="Profile">
                  {() => (
                    <ProfileScreen
                      token={session.token}
                      session={session}
                      onSessionChange={setSession}
                      onLogout={logout}
                      themeMode={themeMode}
                      onToggleTheme={toggleTheme}
                    />
                  )}
                </Tab.Screen>
              </>
            )}
          </Tab.Navigator>
        </NavigationContainer>
      )}
    </SafeAreaProvider>
  );
}
