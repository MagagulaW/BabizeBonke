import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/app', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-shell warm-shell fire-shell">
      <div className="login-panel login-panel-info hero-card delivery-stage">
        <div className="delivery-animation" aria-hidden="true">
          <div className="sun-glow"></div>
          <div className="city-line"></div>
          <div className="food-bag"></div>
          <div className="scooter scooter-a"><span className="wheel left"></span><span className="wheel right"></span><span className="rider"></span></div>
          <div className="scooter scooter-b"><span className="wheel left"></span><span className="wheel right"></span><span className="rider"></span></div>
          <div className="pulse pulse-one"></div>
          <div className="pulse pulse-two"></div>
        </div>
      </div>
      <form className="login-panel" onSubmit={submit}>
        <div className="auth-brand"><img src="/jstart-logo.png" alt="JStart Food Delivery" className="auth-brand-logo" /></div>
        <div className="eyebrow">Sign in</div>
        <h2>Welcome back</h2>
        <label>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" autoComplete="current-password" />
        {error ? <div className="error-box">{error}</div> : null}
        <button className="primary-btn" disabled={loading}>{loading ? 'Signing in...' : 'Sign in'}</button>
        <div className="muted auth-switch">New here? <Link to="/register">Create an account</Link></div>
      </form>
    </div>
  );
}
