import { useState } from 'react';
import type { UserProfile } from '../types/database';
import { loginWithEmail, signUpWithProfile, isSupabaseConfigured, logoutUser } from '../lib/supabase';
import { formatPhilippinePhone } from '../lib/formatters';

interface AuthScreenProps {
  onAuthenticated: (profile: UserProfile) => void;
}

export function AuthScreen({ onAuthenticated }: AuthScreenProps) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [companyName, setCompanyName] = useState('');

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setInfoMsg('');
    setLoading(true);

    try {
      if (mode === 'login') {
        const { profile } = await loginWithEmail(email, password);
        onAuthenticated(profile);
      } else {
        if (!fullName.trim()) throw new Error('Please enter your full name.');
        if (!password || password.length < 6)
          throw new Error('Password must be at least 6 characters.');

        // Public signup is strictly Customer-only
        const res = await signUpWithProfile({
          email,
          password,
          fullName,
          phone: formatPhilippinePhone(phone),
          companyName,
          requestedRole: 'customer',
        });

        if (res.profile) {
          await logoutUser();
        }
        setMode('login');
        setPassword('');
        setInfoMsg(
          res.message || 'Customer account successfully created. Please sign in.'
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Authentication failed';
      setErrorMsg(msg);
      if (mode === 'login') {
        const normalizedMessage = msg.toLowerCase();
        if (normalizedMessage.includes('invalid login credentials')) {
          setInfoMsg(
            'Check your email and password. Note: Staff members must be added by the Administrator.'
          );
        }
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-finset-outer">
      <div className="auth-finset-card">
        {/* Brand Header */}
        <div className="auth-finset-header">
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
            <span className="brand-name">Equip<span>Rent</span></span>
          </div>
          <h1 className="auth-finset-title">
            {mode === 'login' ? 'Welcome back!' : 'Create Customer Account'}
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
            {mode === 'login'
              ? 'Sign in to access your EquipRent account'
              : 'Customer registration for equipment rental bookings'}
          </p>
        </div>

        {/* TABS */}
        <div className="auth-tabs-finset">
          <button
            type="button"
            className={`auth-tab-btn-finset ${mode === 'login' ? 'active' : ''}`}
            onClick={() => {
              setMode('login');
              setErrorMsg('');
              setInfoMsg('');
            }}
          >
            Sign In
          </button>
          <button
            type="button"
            className={`auth-tab-btn-finset ${mode === 'signup' ? 'active' : ''}`}
            onClick={() => {
              setMode('signup');
              setErrorMsg('');
              setInfoMsg('');
            }}
          >
            Create Customer Account
          </button>
        </div>

        {!isSupabaseConfigured && (
          <div style={{ padding: '10px 14px', borderRadius: 12, background: 'var(--red-bg)', color: 'var(--red-kpi)', fontSize: 12, fontWeight: 600, marginBottom: 14 }}>
            Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env, then restart the app.
          </div>
        )}

        {errorMsg && (
          <div style={{ padding: '10px 14px', borderRadius: 12, background: 'var(--red-bg)', color: 'var(--red-kpi)', fontSize: 12, fontWeight: 600, marginBottom: 14 }}>
            {errorMsg}
          </div>
        )}
        {infoMsg && (
          <div style={{ padding: '10px 14px', borderRadius: 12, background: 'var(--green-bg)', color: 'var(--green-kpi)', fontSize: 12, fontWeight: 600, marginBottom: 14 }}>
            {infoMsg}
          </div>
        )}

        {mode === 'signup' && (
          <div style={{ padding: '10px 14px', borderRadius: 12, background: '#f5f3ff', border: '1px solid #ddd6fe', color: '#6d28d9', fontSize: 12, marginBottom: 16 }}>
            🛡️ <strong>Customer Registration Only:</strong> Staff accounts are strictly managed and added by the administrator.
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-form-finset">
          {mode === 'signup' && (
            <>
              <div className="form-group">
                <label>Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="Juan Dela Cruz"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Phone Number</label>
                  <input
                    type="tel"
                    required
                    autoComplete="tel"
                    inputMode="tel"
                    maxLength={16}
                    placeholder="+63 912 345 6789"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    onBlur={() => setPhone((value) => formatPhilippinePhone(value))}
                  />
                </div>
                <div className="form-group">
                  <label>Company / Studio (Optional)</label>
                  <input
                    type="text"
                    placeholder="Studio / Production Co."
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                  />
                </div>
              </div>
            </>
          )}

          <div className="form-group">
            <label>Email Address</label>
            <input
              type="email"
              required
              placeholder="user@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              required
              placeholder="••••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button type="submit" className="auth-submit-purple" disabled={loading || !isSupabaseConfigured}>
            {loading ? (
              'Processing...'
            ) : mode === 'login' ? (
              'Sign In'
            ) : (
              'Create Customer Account'
            )}
          </button>
        </form>

        <div style={{ marginTop: 22, textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
          {mode === 'login' ? (
            <p style={{ margin: 0 }}>
              Need a customer account?{' '}
              <button
                type="button"
                style={{ background: 'transparent', border: 0, color: 'var(--purple-main)', fontWeight: 700, cursor: 'pointer', padding: 0 }}
                onClick={() => {
                  setMode('signup');
                  setErrorMsg('');
                  setInfoMsg('');
                }}
              >
                Register as Customer &rarr;
              </button>
            </p>
          ) : (
            <p style={{ margin: 0 }}>
              Already registered?{' '}
              <button
                type="button"
                style={{ background: 'transparent', border: 0, color: 'var(--purple-main)', fontWeight: 700, cursor: 'pointer', padding: 0 }}
                onClick={() => {
                  setMode('login');
                  setErrorMsg('');
                  setInfoMsg('');
                }}
              >
                Sign in here &rarr;
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
