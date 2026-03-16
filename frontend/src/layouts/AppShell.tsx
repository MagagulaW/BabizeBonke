import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { resolveAssetUrl } from '../lib';

function navigation(user: { roles: string[]; restaurantIds: string[] }) {
  const isAdmin = user.roles.some((role) => ['platform_admin', 'finance_admin', 'content_admin', 'support_admin'].includes(role));
  if (isAdmin) {
    return [
      { to: '/admin', label: '📊 Command Center' },
      { to: '/admin/restaurants', label: '🏪 Restaurants' },
      { to: '/admin/users', label: '👥 Users' },
      { to: '/admin/orders', label: '🧾 Orders' },
      { to: '/admin/drivers', label: '🚚 Drivers' },
      { to: '/admin/customers', label: '🛍️ Customers' },
      { to: '/admin/applications', label: '📋 Applications' },
      { to: '/admin/payouts', label: '🏦 Payouts' }
    ];
  }

  if (user.roles.some((role) => ['restaurant_owner', 'restaurant_manager', 'restaurant_staff'].includes(role))) {
    const restaurantId = user.restaurantIds[0];
    return [
      { to: `/restaurant/${restaurantId}`, label: '📊 Dashboard' },
      { to: `/restaurant/${restaurantId}/menu`, label: '🍽️ Storefront & Menu' },
      { to: `/restaurant/${restaurantId}/orders`, label: '🧾 Orders' },
      { to: `/restaurant/${restaurantId}/inventory`, label: '📦 Inventory' }
    ];
  }

  if (user.roles.includes('driver')) {
    return [
      { to: '/driver', label: '📍 Dashboard' },
      { to: '/driver/deliveries', label: '🛵 Deliveries' },
      { to: '/driver/earnings', label: '💸 Earnings' }
    ];
  }

  return [
    { to: '/customer', label: '🍔 Discover' },
    { to: '/customer/deals', label: '🏷️ Deals' },
    { to: '/customer/cart', label: '🛒 Cart' },
    { to: '/customer/orders', label: '🧾 Orders' },
    { to: '/customer/addresses', label: '📍 Addresses' }
  ];
}

export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  if (!user) return null;
  const links = navigation(user);

  const label = user.roles.some((role) => ['platform_admin', 'finance_admin', 'content_admin', 'support_admin'].includes(role))
    ? 'Admin workspace'
    : user.roles.includes('driver')
      ? 'Driver app'
      : user.roles.includes('customer')
        ? 'Customer app'
        : 'Restaurant workspace';

  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="app-shell">
      <button className="mobile-nav-toggle" onClick={() => setMenuOpen((v) => !v)}>{menuOpen ? '✕ Close' : '☰ Menu'}</button>
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div>
          <div className="brand-mark logo-mark"><img src="/jstart-logo.png" alt="JStart Food Delivery" /></div>
          <div className="brand-title">JStart Food Delivery</div>
          <div className="brand-subtitle">{label}</div>
        </div>

        <nav className="nav-stack">
          {links.map((item) => (
            <NavLink key={item.to} to={item.to} end className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={closeMenu}>
              {item.label}
            </NavLink>
          ))}
          <NavLink to="/profile" end className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={closeMenu}>👤 Profile</NavLink>
        </nav>

        <div className="sidebar-footer">
          <div className="user-badge">
            <div className="user-badge-avatar">{user.profileImageUrl ? <img src={resolveAssetUrl(user.profileImageUrl)} alt={user.fullName} /> : <span>{user.fullName.slice(0, 1).toUpperCase()}</span>}</div>
            <div>
              <div className="user-badge-name">Welcome, {user.fullName}</div>
              <div className="user-badge-role">{user.roles.join(', ')}</div>
            </div>
          </div>
          <button className="secondary-btn block" onClick={() => { closeMenu(); logout(); navigate('/'); }}>Sign out</button>
        </div>
      </aside>

      {menuOpen ? <div className="sidebar-backdrop" onClick={closeMenu} /> : null}

      <main className="content-area">
        <Outlet />
      </main>
    </div>
  );
}
