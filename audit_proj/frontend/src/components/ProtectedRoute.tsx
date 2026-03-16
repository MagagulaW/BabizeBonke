import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { AppSplash } from './AppSplash';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, isReady } = useAuth();
  if (!isReady) return <AppSplash message="Checking your session..." />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
