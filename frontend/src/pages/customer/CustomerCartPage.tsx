import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, currency } from '../../lib';
import { useAuth } from '../../contexts/AuthContext';
import { MapPicker } from '../../components/MapComponents';

type Cart = null | { id: string; restaurant_name: string; subtotal_amount: string | number; delivery_fee_amount: string | number; tax_amount: string | number; total_amount: string | number; items: { id: string; item_name: string; quantity: number; line_total: string | number }[] };
type Address = { id: string; label: string; address_line1: string; city: string; province: string; is_default: boolean; latitude?: number; longitude?: number };
type PaymentMethodCode = 'card' | 'saved_card' | 'cash_on_delivery' | 'eft_bank_transfer';
type AvailableMethod = { code: PaymentMethodCode; label: string; description: string; requiresOnlineFlow: boolean };
type SavedCard = { id: string; brand: string; last4: string; expires_month: number; expires_year: number; is_default: boolean };
type DemoCardForm = { cardholderName: string; cardNumber: string; expiryMonth: string; expiryYear: string; cvv: string };

const demoSeedCards = [
  { label: 'Visa demo', cardholderName: 'Wandile Magagula', cardNumber: '4242 4242 4242 4242', expiryMonth: '12', expiryYear: String(new Date().getFullYear() + 2), cvv: '123' },
  { label: 'Mastercard demo', cardholderName: 'Urban Bites Owner', cardNumber: '5555 5555 5555 4444', expiryMonth: '11', expiryYear: String(new Date().getFullYear() + 3), cvv: '456' }
];

function sanitizeDigits(value: string, max: number) {
  return value.replace(/\D/g, '').slice(0, max);
}

function formatCardNumber(value: string) {
  return sanitizeDigits(value, 19).replace(/(.{4})/g, '$1 ').trim();
}

function isLuhnValid(cardNumber: string) {
  const digits = sanitizeDigits(cardNumber, 19);
  if (digits.length < 13) return false;
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = Number(digits[i]);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

function validateDemoCard(card: DemoCardForm) {
  const digits = sanitizeDigits(card.cardNumber, 19);
  const month = Number(card.expiryMonth);
  const year = Number(card.expiryYear);
  const cvv = sanitizeDigits(card.cvv, 4);
  const currentYear = new Date().getFullYear();
  if (!card.cardholderName.trim()) return 'Cardholder name is required.';
  if (digits.length < 13 || digits.length > 19) return 'Card number must be between 13 and 19 digits.';
  if (!isLuhnValid(digits)) return 'Card number format is invalid.';
  if (!Number.isInteger(month) || month < 1 || month > 12) return 'Expiry month must be between 01 and 12.';
  if (!Number.isInteger(year) || year < currentYear || year > currentYear + 20) return 'Expiry year is invalid.';
  if (!/^\d{3,4}$/.test(cvv)) return 'CVV must be 3 or 4 digits.';
  const expiryDate = new Date(year, month, 0, 23, 59, 59, 999);
  if (expiryDate < new Date()) return 'Card has expired.';
  return null;
}

export function CustomerCartPage() {
  const { token } = useAuth();
  const [cart, setCart] = useState<Cart>(null);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [availableMethods, setAvailableMethods] = useState<AvailableMethod[]>([]);
  const [savedCards, setSavedCards] = useState<SavedCard[]>([]);
  const [addressId, setAddressId] = useState('');
  const [busy, setBusy] = useState(false);
  const [savingCard, setSavingCard] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodCode>('card');
  const [selectedSavedCardId, setSelectedSavedCardId] = useState('');
  const [bankTransferReference, setBankTransferReference] = useState('');
  const [newCard, setNewCard] = useState({ brand: 'Visa', last4: '', expiresMonth: String(new Date().getMonth() + 1).padStart(2, '0'), expiresYear: String(new Date().getFullYear() + 2) });
  const [paymentPickerOpen, setPaymentPickerOpen] = useState(true);
  const [cardForm, setCardForm] = useState<DemoCardForm>({ cardholderName: '', cardNumber: '', expiryMonth: String(new Date().getMonth() + 1).padStart(2, '0'), expiryYear: String(new Date().getFullYear() + 2), cvv: '' });
  const [cardError, setCardError] = useState('');

  const selectedMethod = useMemo(() => availableMethods.find((m) => m.code === paymentMethod), [availableMethods, paymentMethod]);
  const selectedAddress = useMemo(() => addresses.find((a) => a.id === addressId) || null, [addresses, addressId]);
  const cardValidationError = useMemo(() => validateDemoCard(cardForm), [cardForm]);
  const canCheckout = !!addressId && !busy && (
    paymentMethod === 'cash_on_delivery' ||
    paymentMethod === 'eft_bank_transfer' ||
    (paymentMethod === 'saved_card' && !!selectedSavedCardId) ||
    (paymentMethod === 'card' && !cardValidationError)
  );

  async function load() {
    if (!token) return;
    const [cartData, addressData, methodData, savedCardData] = await Promise.all([
      api<Cart>('/customer/cart', {}, token),
      api<Address[]>('/customer/addresses', {}, token),
      api<{ methods: AvailableMethod[] }>('/payments/methods/available', {}, token),
      api<SavedCard[]>('/payments/methods/saved', {}, token)
    ]);
    setCart(cartData);
    setAddresses(addressData);
    setAvailableMethods(methodData.methods);
    setSavedCards(savedCardData);
    setAddressId(addressData.find((a) => a.is_default)?.id || addressData[0]?.id || '');
    const defaultSaved = savedCardData.find((c) => c.is_default) || savedCardData[0];
    setSelectedSavedCardId(defaultSaved?.id || '');
    if (!savedCardData.length && paymentMethod === 'saved_card') setPaymentMethod('card');
  }

  useEffect(() => { load().catch(console.error); }, [token]);
  useEffect(() => { setPaymentPickerOpen(false); }, [paymentMethod]);

  async function updateQuantity(itemId: string, quantity: number) {
    if (!token) return;
    await api('/customer/cart/items/' + itemId, { method: 'PATCH', body: JSON.stringify({ quantity }) }, token);
    await load();
  }

  async function removeItem(itemId: string) {
    if (!token) return;
    await api('/customer/cart/items/' + itemId, { method: 'DELETE' }, token);
    await load();
  }

  async function saveCard() {
    if (!token) return;
    if (!/^\d{4}$/.test(newCard.last4)) {
      alert('Last 4 digits must be exactly 4 numbers.');
      return;
    }
    setSavingCard(true);
    try {
      await api('/payments/methods/saved/card', {
        method: 'POST',
        body: JSON.stringify({
          brand: newCard.brand,
          last4: newCard.last4,
          expiresMonth: Number(newCard.expiresMonth),
          expiresYear: Number(newCard.expiresYear),
          isDefault: !savedCards.length
        })
      }, token);
      setPaymentMethod('saved_card');
      setNewCard({ brand: 'Visa', last4: '', expiresMonth: String(new Date().getMonth() + 1).padStart(2, '0'), expiresYear: String(new Date().getFullYear() + 2) });
      await load();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to save card');
    } finally {
      setSavingCard(false);
    }
  }

  function fillDemoCard(index: number) {
    const card = demoSeedCards[index];
    if (!card) return;
    setCardForm(card);
    setCardError('');
  }

  async function checkout() {
    if (!token || !cart) return;
    const validationMessage = paymentMethod === 'card' ? cardValidationError : null;
    if (validationMessage) {
      setCardError(validationMessage);
      return;
    }
    setBusy(true);
    try {
      const order = await api<{ id: string; payment_method: PaymentMethodCode; payment_status: string }>('/customer/checkout', {
        method: 'POST',
        body: JSON.stringify({
          orderType: 'delivery',
          addressId,
          tipAmount: 0,
          paymentMethod,
          paymentMethodId: paymentMethod === 'saved_card' ? selectedSavedCardId : null,
          bankTransferReference: paymentMethod === 'eft_bank_transfer' ? bankTransferReference || null : null,
          demoCard: paymentMethod === 'card' ? {
            cardholderName: cardForm.cardholderName.trim(),
            cardNumberLast4: sanitizeDigits(cardForm.cardNumber, 19).slice(-4),
            expiryMonth: Number(cardForm.expiryMonth),
            expiryYear: Number(cardForm.expiryYear),
            brand: sanitizeDigits(cardForm.cardNumber, 1).startsWith('4') ? 'Visa' : 'Mastercard'
          } : null
        })
      }, token);

      alert(`Order placed with ${paymentMethod.replace(/_/g, ' ')}. Payment status: ${order.payment_status}.`);
      setCardError('');
      await load();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Checkout failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-shell">
      <div className="page-header"><div><div className="eyebrow">Customer app</div><h1>Your cart</h1><p>Review items, confirm the exact delivery pin on the map, choose how to pay, and place your order.</p></div></div>
      {!cart ? <section className="panel">Your cart is empty.</section> : <div className="grid-two"><section className="panel"><div className="panel-header"><h3>{cart.restaurant_name}</h3></div><div className="stack-list">{cart.items.map((item) => <div className="stack-item" key={item.id}><div><strong>{item.item_name}</strong><div className="muted">Qty {item.quantity}</div></div><div className="actions"><strong>{currency(item.line_total)}</strong><button className="chip-btn" onClick={() => updateQuantity(item.id, Math.max(1, item.quantity - 1))}>-</button><button className="chip-btn" onClick={() => updateQuantity(item.id, item.quantity + 1)}>+</button><button className="chip-btn warning" onClick={() => removeItem(item.id)}>Remove</button></div></div>)}</div></section><section className="panel"><div className="panel-header"><h3>Checkout</h3></div><label>Delivery address</label><select value={addressId} onChange={(e) => setAddressId(e.target.value)}>{addresses.map((a) => <option key={a.id} value={a.id}>{a.label} - {a.address_line1}, {a.city}</option>)}</select>
      {selectedAddress?.latitude != null ? <div className="payment-detail-box"><div className="panel-header compact"><strong>Delivery pin</strong><Link to="/customer/addresses" className="secondary-btn inline-btn">Edit saved pins</Link></div><div className="muted">Exact dropoff location used for live driver tracking and navigation.</div><MapPicker value={{ latitude: Number(selectedAddress.latitude), longitude: Number(selectedAddress.longitude) }} onChange={() => {}} height={220} /><div className="map-coords">Lat {Number(selectedAddress.latitude).toFixed(5)} · Lng {Number(selectedAddress.longitude).toFixed(5)}</div></div> : <div className="payment-detail-box"><strong>No delivery pin selected</strong><span className="muted">Add a saved address with a map pin before checkout.</span><Link to="/customer/addresses" className="primary-btn inline-btn">Add delivery pin</Link></div>}
      {paymentPickerOpen ? (
        <div className="payment-detail-box">
          <div className="panel-header compact"><strong>Select payment option</strong></div>
          <div className="payment-method-grid">{availableMethods.map((method) => <button key={method.code} type="button" className={`payment-method-card ${paymentMethod === method.code ? 'selected' : ''}`} onClick={() => { setPaymentMethod(method.code); setPaymentPickerOpen(false); }}><strong>{method.label}</strong><span>{method.description}</span></button>)}</div>
        </div>
      ) : (
        <div className="payment-detail-box">
          <div className="panel-header compact"><strong>Payment option</strong><button type="button" className="secondary-btn inline-btn" onClick={() => setPaymentPickerOpen(true)}>Change payment option</button></div>
          <div className="muted">Selected: {selectedMethod?.label || paymentMethod}</div>
        </div>
      )}
      {!paymentPickerOpen && paymentMethod === 'saved_card' && (
        <div className="payment-detail-box">
          {!savedCards.length ? <div className="muted">No saved cards yet. Add one below to enable fast checkout.</div> : <>
            <label>Choose saved card</label>
            <select value={selectedSavedCardId} onChange={(e) => setSelectedSavedCardId(e.target.value)}>{savedCards.map((card) => <option key={card.id} value={card.id}>{card.brand} •••• {card.last4} {card.is_default ? '(Default)' : ''}</option>)}</select>
          </>}
        </div>
      )}
      {!paymentPickerOpen && paymentMethod === 'eft_bank_transfer' && (
        <div className="payment-detail-box">
          <strong>EFT / Bank Transfer</strong>
          <span className="muted">Use your bank app to transfer, then record the reference so your operations team can reconcile payment faster.</span>
          <label>Bank reference</label>
          <input value={bankTransferReference} onChange={(e) => setBankTransferReference(e.target.value)} placeholder="EFT123456" />
        </div>
      )}
      {!paymentPickerOpen && paymentMethod === 'cash_on_delivery' && <div className="payment-detail-box"><strong>Cash on Delivery</strong><span className="muted">The driver will collect payment when the order arrives.</span></div>}
      {!paymentPickerOpen && paymentMethod === 'card' && (
        <div className="payment-detail-box">
          <div className="panel-header compact"><strong>Card checkout</strong><div className="actions"><button type="button" className="secondary-btn inline-btn" onClick={() => fillDemoCard(0)}>Visa demo</button><button type="button" className="secondary-btn inline-btn" onClick={() => fillDemoCard(1)}>Mastercard demo</button></div></div>
          <div className="muted">This is a demo card form. Enter a properly formatted card and the order will process without contacting a live bank.</div>
          <div className="form-grid-2 compact-grid">
            <div><label>Cardholder name</label><input value={cardForm.cardholderName} onChange={(e) => { setCardForm({ ...cardForm, cardholderName: e.target.value }); setCardError(''); }} placeholder="Name on card" /></div>
            <div><label>Card number</label><input inputMode="numeric" autoComplete="cc-number" value={cardForm.cardNumber} onChange={(e) => { setCardForm({ ...cardForm, cardNumber: formatCardNumber(e.target.value) }); setCardError(''); }} placeholder="4242 4242 4242 4242" /></div>
            <div><label>Expiry month</label><input inputMode="numeric" autoComplete="cc-exp-month" value={cardForm.expiryMonth} onChange={(e) => { setCardForm({ ...cardForm, expiryMonth: sanitizeDigits(e.target.value, 2) }); setCardError(''); }} placeholder="08" /></div>
            <div><label>Expiry year</label><input inputMode="numeric" autoComplete="cc-exp-year" value={cardForm.expiryYear} onChange={(e) => { setCardForm({ ...cardForm, expiryYear: sanitizeDigits(e.target.value, 4) }); setCardError(''); }} placeholder="2029" /></div>
            <div><label>CVV</label><input inputMode="numeric" autoComplete="cc-csc" value={cardForm.cvv} onChange={(e) => { setCardForm({ ...cardForm, cvv: sanitizeDigits(e.target.value, 4) }); setCardError(''); }} placeholder="123" /></div>
          </div>
          {(cardError || cardValidationError) ? <div className="muted" style={{ color: '#ef4444' }}>{cardError || cardValidationError}</div> : <div className="muted">Accepted demo formats: Visa or Mastercard with valid number structure, future expiry, and CVV.</div>}
        </div>
      )}
      {!paymentPickerOpen && paymentMethod === 'saved_card' && (
        <div className="payment-detail-box">
          <strong>Add another saved card</strong>
          <div className="form-grid-2 compact-grid">
            <div><label>Brand</label><select value={newCard.brand} onChange={(e) => setNewCard({ ...newCard, brand: e.target.value })}><option>Visa</option><option>Mastercard</option></select></div>
            <div><label>Last 4 digits</label><input value={newCard.last4} onChange={(e) => setNewCard({ ...newCard, last4: e.target.value.replace(/\D/g, '').slice(0, 4) })} placeholder="4242" /></div>
            <div><label>Expiry month</label><input value={newCard.expiresMonth} onChange={(e) => setNewCard({ ...newCard, expiresMonth: e.target.value.replace(/\D/g, '').slice(0, 2) })} placeholder="08" /></div>
            <div><label>Expiry year</label><input value={newCard.expiresYear} onChange={(e) => setNewCard({ ...newCard, expiresYear: e.target.value.replace(/\D/g, '').slice(0, 4) })} placeholder="2029" /></div>
          </div>
          <button type="button" className="secondary-btn inline-btn" disabled={savingCard} onClick={saveCard}>{savingCard ? 'Saving card...' : 'Save card'}</button>
        </div>
      )}
      <div className="tracking-card"><div><strong>Subtotal</strong> {currency(cart.subtotal_amount)}</div><div><strong>Delivery</strong> {currency(cart.delivery_fee_amount)}</div><div><strong>Tax</strong> {currency(cart.tax_amount)}</div><div><strong>Total</strong> {currency(cart.total_amount)}</div><div className="muted">Payment flow: {selectedMethod?.label || paymentMethod}</div></div>
      <button className="primary-btn block" disabled={!canCheckout} onClick={checkout}>{busy ? 'Placing order...' : 'Place order'}</button></section></div>}
    </div>
  );
}
