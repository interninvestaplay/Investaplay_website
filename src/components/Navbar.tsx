import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export const Navbar: React.FC = () => {
  const { user, logout } = useAuth();
  const location = useLocation();

  const isActive = (path: string) => location.pathname === path;

  return (
    <header
      className="site-header"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        backgroundColor: 'rgba(255, 255, 255, 0.85)',
        backdropFilter: 'blur(24px) saturate(180%)',
        WebkitBackdropFilter: 'blur(24px) saturate(180%)',
        borderBottom: '1.5px solid rgba(255, 255, 255, 0.9)',
        padding: '12px 32px',
        boxShadow: '0 4px 20px rgba(124, 58, 237, 0.06), 0 1px 3px rgba(15, 23, 42, 0.04)',
        transition: 'all 0.25s ease',
      }}
    >
      <div
        className="site-header-inner"
        style={{
          maxWidth: '1640px',
          width: '100%',
          margin: '0 auto',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '20px',
        }}
      >
        {/* Brand Logo & Studio Identity */}
        <Link
          to="/"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            textDecoration: 'none',
          }}
        >
          <div
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <img
              src="/assets/quizzyfox.png"
              alt="QuizzyFox"
              className="float-effect"
              style={{
                width: '40px',
                height: '40px',
                objectFit: 'contain',
                filter: 'drop-shadow(0 2px 8px rgba(124, 58, 237, 0.25))',
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span
                className="site-brand-name"
                style={{
                  fontFamily: 'var(--font-heading)',
                  fontSize: '20px',
                  fontWeight: 800,
                  letterSpacing: '-0.02em',
                  color: 'var(--text-primary)',
                  lineHeight: 1.1,
                }}
              >
                Quizzy<span style={{ color: '#F97316' }}>Fox</span>
              </span>
              <span
                className="site-brand-badge"
                style={{
                  fontSize: '9px',
                  fontWeight: 700,
                  fontFamily: 'var(--font-mono)',
                  padding: '1px 5px',
                  borderRadius: '4px',
                  background: '#F5F3FF',
                  color: '#7C3AED',
                  border: '1px solid #DDD6FE',
                  letterSpacing: '0.04em',
                }}
              >
                APP
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '1px' }}>
              <img
                src="/assets/investaplay-logo.png"
                alt="InvestaPlay Studio"
                style={{ width: '13px', height: '13px', objectFit: 'contain' }}
              />
              <span
                className="site-brand-subtitle"
                style={{
                  fontSize: '9px',
                  fontWeight: 600,
                  letterSpacing: '0.03em',
                  color: 'var(--text-muted)',
                  fontFamily: 'var(--font-body)',
                }}
              >
                Powered by InvestaPlay Studio
              </span>
            </div>
          </div>
        </Link>

        {/* Center Nav Links - Light Segmented Style */}
        <nav
          className="site-nav"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            background: '#F1F5F9',
            padding: '4px',
            borderRadius: '12px',
            border: '1px solid #E2E8F0',
          }}
        >
          <Link
            to="/"
            style={{
              padding: '7px 16px',
              borderRadius: '9px',
              fontSize: '13px',
              fontWeight: 600,
              textDecoration: 'none',
              color: isActive('/') ? '#7C3AED' : 'var(--text-secondary)',
              backgroundColor: isActive('/') ? '#FFFFFF' : 'transparent',
              boxShadow: isActive('/') ? '0 1px 3px rgba(15, 23, 42, 0.08)' : 'none',
              transition: 'all 0.15s ease',
            }}
          >
            Home
          </Link>

          <Link
            to={user ? "/quick-quiz" : "/login"}
            state={user ? undefined : { from: { pathname: '/quick-quiz' }, message: 'Please Sign In or Register to play Quick Quiz AI!' }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 14px',
              borderRadius: '9px',
              fontSize: '13px',
              fontWeight: 600,
              textDecoration: 'none',
              color: isActive('/quick-quiz') ? '#C2410C' : 'var(--text-secondary)',
              backgroundColor: isActive('/quick-quiz') ? '#FFF7ED' : 'transparent',
              border: isActive('/quick-quiz') ? '1px solid #FFEDD5' : '1px solid transparent',
              transition: 'all 0.15s ease',
            }}
          >
            <img
              src="/assets/icon-ai-star.png"
              alt="Quick Quiz AI"
              style={{
                width: '18px',
                height: '18px',
                objectFit: 'contain',
              }}
            />
            <span>Quick Quiz AI</span>
          </Link>

          <Link
            to={user ? "/friends" : "/login"}
            state={user ? undefined : { from: { pathname: '/friends' }, message: 'Please Sign In or Register to enter 1v1 Arena!' }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 14px',
              borderRadius: '9px',
              fontSize: '13px',
              fontWeight: 600,
              textDecoration: 'none',
              color: isActive('/friends') ? '#6D28D9' : 'var(--text-secondary)',
              backgroundColor: isActive('/friends') ? '#F5F3FF' : 'transparent',
              border: isActive('/friends') ? '1px solid #DDD6FE' : '1px solid transparent',
              transition: 'all 0.15s ease',
            }}
          >
            <img
              src="/assets/icon-swords.png"
              alt="1v1 Arena"
              style={{
                width: '18px',
                height: '18px',
                objectFit: 'contain',
              }}
            />
            <span>1v1 Arena</span>
          </Link>

          <Link
            to="/leaderboard"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 14px',
              borderRadius: '9px',
              fontSize: '13px',
              fontWeight: 600,
              textDecoration: 'none',
              color: isActive('/leaderboard') ? '#B45309' : 'var(--text-secondary)',
              backgroundColor: isActive('/leaderboard') ? '#FEF3C7' : 'transparent',
              border: isActive('/leaderboard') ? '1px solid #FDE68A' : '1px solid transparent',
              transition: 'all 0.15s ease',
            }}
          >
            <img
              src="/assets/trophy.png"
              alt="Rankings"
              style={{
                width: '18px',
                height: '18px',
                objectFit: 'contain',
              }}
            />
            <span>Rankings</span>
          </Link>
        </nav>

        {/* Right User Stats & Actions (No Guest Login Option) */}
        <div className="site-user-stats" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {user ? (
            <>
              {/* Coins Pill */}
              <div
                className="site-coins"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  backgroundColor: '#FEF3C7',
                  border: '1px solid #FDE68A',
                  padding: '5px 12px',
                  borderRadius: '999px',
                  fontWeight: 700,
                  fontSize: '13px',
                  color: '#B45309',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                <img
                  src="/assets/coins.png"
                  alt="Coins"
                  style={{ width: '18px', height: '18px', objectFit: 'contain' }}
                />
                <span>{user.coins ?? 100}</span>
              </div>

              {/* Level Badge */}
              <div
                className="site-level"
                style={{
                  backgroundColor: '#F5F3FF',
                  border: '1px solid #DDD6FE',
                  padding: '5px 10px',
                  borderRadius: '999px',
                  fontWeight: 700,
                  fontSize: '12px',
                  color: '#6D28D9',
                  fontFamily: 'var(--font-mono)',
                  letterSpacing: '0.02em',
                }}
              >
                LVL {user.level || 1}
              </div>

              {/* Profile Chip */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  background: '#FFFFFF',
                  padding: '4px 12px 4px 4px',
                  borderRadius: '999px',
                  border: '1px solid #E2E8F0',
                  boxShadow: '0 1px 3px rgba(15, 23, 42, 0.05)',
                }}
              >
                <div style={{ position: 'relative' }}>
                  <img
                    src="/assets/avatars/01-young-boy.webp"
                    alt="User Avatar"
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '50%',
                      objectFit: 'cover',
                      display: 'block',
                    }}
                  />
                  <span
                    className="online-indicator"
                    style={{
                      position: 'absolute',
                      bottom: '-1px',
                      right: '-1px',
                      width: '7px',
                      height: '7px',
                      border: '1.5px solid #FFFFFF',
                    }}
                  />
                </div>
                <span className="site-user-name" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {user.displayName || user.username}
                </span>
              </div>

              {/* Logout Button */}
              <button
                onClick={logout}
                title="Sign out"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: '6px',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  transition: 'color 0.15s ease',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#EF4444')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
              >
                <LogOut size={16} />
              </button>
            </>
          ) : (
            <Link
              to="/login"
              className="btn btn-primary btn-shimmer"
              style={{ padding: '8px 20px', fontSize: '13px' }}
            >
              <span>Sign In / Register</span>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
};
