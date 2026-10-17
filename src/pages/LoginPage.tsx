import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { User, Lock, Mail, ArrowRight, ShieldCheck, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export const LoginPage: React.FC = () => {
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { login, signup } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const stateObj = location.state as { from?: { pathname: string }; message?: string } | null;
  const destination = stateObj?.from?.pathname || '/';
  const promptMessage = stateObj?.message;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (tab === 'login') {
        await login({ username, password });
      } else {
        await signup({ username, email, password, displayName: displayName || username });
      }
      navigate(destination, { replace: true });
    } catch (err: any) {
      setError(err.message || 'Authentication failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '440px', margin: '40px auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Brand Icon & Heading */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        <div
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '128px',
            height: '128px',
            margin: '0 auto 16px auto',
          }}
        >
          <img
            src="/assets/quizzyfox.png"
            alt="QuizzyFox"
            className="float-effect"
            style={{
              width: '120px',
              height: '120px',
              objectFit: 'contain',
              filter: 'drop-shadow(0 10px 24px rgba(124, 58, 237, 0.28)) drop-shadow(0 2px 8px rgba(249, 115, 22, 0.2))',
              display: 'block',
            }}
          />
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
          <span className="badge badge-purple" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 12px' }}>
            <img
              src="/assets/investaplay-logo.png"
              alt="InvestaPlay Studio"
              style={{ width: '16px', height: '16px', objectFit: 'contain' }}
            />
            <span style={{ fontWeight: 700, letterSpacing: '0.02em' }}>Powered by InvestaPlay Studio</span>
          </span>
        </div>
        <h1
          style={{
            fontFamily: 'var(--font-heading)',
            fontSize: '32px',
            fontWeight: 800,
            letterSpacing: '-0.02em',
            color: 'var(--text-primary)',
            marginBottom: '6px',
          }}
        >
          Welcome to Quizzy<span style={{ color: '#F97316' }}>Fox</span>
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.5 }}>
          Sign in or create an account to challenge friends and climb the rankings
        </p>
      </div>

      {/* Auth Card - Light Theme */}
      <div
        className="glass-panel"
        style={{
          padding: '36px 32px',
          background: 'rgba(255, 255, 255, 0.92)',
          backdropFilter: 'blur(24px) saturate(180%)',
          border: '1.5px solid rgba(255, 255, 255, 0.95)',
          boxShadow: '0 20px 45px -10px rgba(124, 58, 237, 0.16), 0 4px 16px rgba(15, 23, 42, 0.05)',
          borderRadius: '24px',
        }}
      >
        {promptMessage && (
          <div
            style={{
              backgroundColor: '#FFF7ED',
              border: '1.5px solid #FDBA74',
              color: '#C2410C',
              padding: '12px 16px',
              borderRadius: '12px',
              fontSize: '13.5px',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              marginBottom: '20px',
              boxShadow: '0 2px 8px rgba(249, 115, 22, 0.12)',
            }}
          >
            <ShieldCheck size={20} color="#EA580C" style={{ flexShrink: 0 }} />
            <span>{promptMessage}</span>
          </div>
        )}

        {/* Tab Switcher */}
        <div
          style={{
            display: 'flex',
            background: '#F1F5F9',
            borderRadius: '12px',
            padding: '4px',
            marginBottom: '24px',
            border: '1px solid #E2E8F0',
          }}
        >
          <button
            type="button"
            onClick={() => {
              setTab('login');
              setError(null);
            }}
            style={{
              flex: 1,
              padding: '10px',
              borderRadius: '9px',
              border: 'none',
              background: tab === 'login' ? 'var(--purple-gradient)' : 'transparent',
              color: tab === 'login' ? '#FFFFFF' : 'var(--text-muted)',
              fontWeight: 700,
              fontSize: '14px',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              boxShadow: tab === 'login' ? '0 2px 8px rgba(124, 58, 237, 0.25)' : 'none',
            }}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('register');
              setError(null);
            }}
            style={{
              flex: 1,
              padding: '10px',
              borderRadius: '9px',
              border: 'none',
              background: tab === 'register' ? 'var(--purple-gradient)' : 'transparent',
              color: tab === 'register' ? '#FFFFFF' : 'var(--text-muted)',
              fontWeight: 700,
              fontSize: '14px',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              boxShadow: tab === 'register' ? '0 2px 8px rgba(124, 58, 237, 0.25)' : 'none',
            }}
          >
            Create Account
          </button>
        </div>

        {error && (
          <div
            style={{
              backgroundColor: '#FEF2F2',
              border: '1px solid #FECACA',
              color: '#DC2626',
              padding: '12px',
              borderRadius: '10px',
              fontSize: '13px',
              marginBottom: '18px',
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {tab === 'register' && (
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>
                Display Name
              </label>
              <div style={{ position: 'relative' }}>
                <User size={16} color="var(--text-muted)" style={{ position: 'absolute', left: '14px', top: '15px' }} />
                <input
                  type="text"
                  placeholder="Your Name (e.g. Quiz Master)"
                  className="input-field"
                  style={{ paddingLeft: '40px' }}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>
            </div>
          )}

          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>
              Username
            </label>
            <div style={{ position: 'relative' }}>
              <User size={16} color="var(--text-muted)" style={{ position: 'absolute', left: '14px', top: '15px' }} />
              <input
                type="text"
                placeholder="Enter username"
                required
                className="input-field"
                style={{ paddingLeft: '40px' }}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
          </div>

          {tab === 'register' && (
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>
                Email Address
              </label>
              <div style={{ position: 'relative' }}>
                <Mail size={16} color="var(--text-muted)" style={{ position: 'absolute', left: '14px', top: '15px' }} />
                <input
                  type="email"
                  placeholder="name@example.com"
                  required
                  className="input-field"
                  style={{ paddingLeft: '40px' }}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>
          )}

          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>
              Password
            </label>
            <div style={{ position: 'relative' }}>
              <Lock size={16} color="var(--text-muted)" style={{ position: 'absolute', left: '14px', top: '15px' }} />
              <input
                type="password"
                placeholder="••••••••"
                required
                className="input-field"
                style={{ paddingLeft: '40px' }}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn btn-primary btn-shimmer"
            style={{ width: '100%', marginTop: '8px', padding: '14px', borderRadius: '14px' }}
          >
            {loading ? 'Please wait...' : tab === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>
      </div>
    </div>
  );
};
