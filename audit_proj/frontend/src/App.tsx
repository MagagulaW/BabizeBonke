import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { LoginPage } from './pages/LoginPage';
import { PublicLandingPage } from './pages/PublicLandingPage';
import { RegisterPage } from './pages/RegisterPage';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppShell } from './layouts/AppShell';
import { AdminDashboard } from './pages/admin/AdminDashboard';
import { AdminRestaurantsPage } from './pages/admin/AdminRestaurantsPage';
import { AdminUsersPage } from './pages/admin/AdminUsersPage';
import { AdminOrdersPage } from './pages/admin/AdminOrdersPage';
import { AdminDriversPage } from './pages/admin/AdminDriversPage';
import { AdminCustomersPage } from './pages/admin/AdminCustomersPage';
import { AdminApplicationsPage } from './pages/admin/AdminApplicationsPage';
import { RestaurantDashboard } from './pages/restaurant/RestaurantDashboard';
import { RestaurantMenuPage } from './pages/restaurant/RestaurantMenuPage';
import { RestaurantOrdersPage } from './pages/restaurant/RestaurantOrdersPage';
import { RestaurantInventoryPage } from './pages/restaurant/RestaurantInventoryPage';
import { CustomerHomePage } from './pages/customer/CustomerHomePage';
import { CustomerRestaurantPage } from './pages/customer/CustomerRestaurantPage';
import { CustomerCartPage } from './pages/customer/CustomerCartPage';
import { CustomerOrdersPage } from './pages/customer/CustomerOrdersPage';
import { CustomerAddressesPage } from './pages/customer/CustomerAddressesPage';
import { DriverDashboard } from './pages/driver/DriverDashboard';
import { DriverDeliveriesPage } from './pages/driver/DriverDeliveriesPage';
import { DriverEarningsPage } from './pages/driver/DriverEarningsPage';
import { ProfilePage } from './pages/ProfilePage';
import { CustomerDealsPage } from './pages/customer/CustomerDealsPage';
import { AppSplash } from './components/AppSplash';

function RootRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  const isAdmin = user.roles.some((role) => ['platform_admin', 'finance_admin', 'content_admin', 'support_admin'].includes(role));
  if (isAdmin) return <Navigate to="/admin" replace />;
  if (user.roles.includes('restaurant_owner') || user.roles.includes('restaurant_manager') || user.roles.includes('restaurant_staff')) {
    if (user.restaurantIds[0]) return <Navigate to={`/restaurant/${user.restaurantIds[0]}`} replace />;
  }
  if (user.roles.includes('driver')) return <Navigate to="/driver" replace />;
  if (user.roles.includes('customer')) return <Navigate to="/customer" replace />;
  return <Navigate to="/login" replace />;
}

export default function App() {
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setBooting(false), 1200);
    return () => window.clearTimeout(timer);
  }, []);

  if (booting) return <AppSplash message="Preparing fresh deals and live delivery..." />;

  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<PublicLandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/app" element={<RootRedirect />} />
          <Route path="/" element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
            <Route path="admin" element={<AdminDashboard />} />
            <Route path="admin/restaurants" element={<AdminRestaurantsPage />} />
            <Route path="admin/users" element={<AdminUsersPage />} />
            <Route path="admin/orders" element={<AdminOrdersPage />} />
            <Route path="admin/drivers" element={<AdminDriversPage />} />
            <Route path="admin/customers" element={<AdminCustomersPage />} />
            <Route path="admin/applications" element={<AdminApplicationsPage />} />
            <Route path="restaurant/:restaurantId" element={<RestaurantDashboard />} />
            <Route path="restaurant/:restaurantId/menu" element={<RestaurantMenuPage />} />
            <Route path="restaurant/:restaurantId/orders" element={<RestaurantOrdersPage />} />
            <Route path="restaurant/:restaurantId/inventory" element={<RestaurantInventoryPage />} />
            <Route path="customer" element={<CustomerHomePage />} />
            <Route path="customer/restaurants/:restaurantId" element={<CustomerRestaurantPage />} />
            <Route path="customer/deals" element={<CustomerDealsPage />} />
            <Route path="customer/cart" element={<CustomerCartPage />} />
            <Route path="customer/orders" element={<CustomerOrdersPage />} />
            <Route path="customer/addresses" element={<CustomerAddressesPage />} />
            <Route path="driver" element={<DriverDashboard />} />
            <Route path="driver/deliveries" element={<DriverDeliveriesPage />} />
            <Route path="driver/earnings" element={<DriverEarningsPage />} />
            <Route path="profile" element={<ProfilePage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
