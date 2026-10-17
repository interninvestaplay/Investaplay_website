import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Sparkles,
  Swords,
  Trophy,
  Flame,
  ArrowRight,
  ShieldCheck,
  Cpu,
  Radio,
  Timer,
  Users,
  LogIn,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { OnlinePlayer } from '../types';

export const HomePage: React.FC = () => {
  const { user, updateCoins } = useAuth();
  const navigate = useNavigate();

  const [onlinePlayers, setOnlinePlayers] = useState<OnlinePlayer[]>([]);
  const [loadingPlayers, setLoadingPlayers] = useState(false);
  const [claimedDaily, setClaimedDaily] = useState(false);
  const [claiming, setClaiming] = useState(false);

  useEffect(() => {
    const fetchOnline = async () => {
      setLoadingPlayers(true);
      try {
        const res = await api.getOnlinePlayers();
        setOnlinePlayers(res.players || []);
      } catch (err) {
        console.warn('Failed to load online players:', err);
      } finally {
        setLoadingPlayers(false);
      }
    };
    fetchOnline();
  }, []);

  const handleClaimStreak = async () => {
    if (claimedDaily || claiming) return;
    setClaiming(true);
    try {
      const res = await api.claimDailyStreak();
      if (res.coins) {
        updateCoins(res.coins);
      }
      setClaimedDaily(true);
    } catch {
      setClaimedDaily(true);
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '48px' }}>
      {/* Hero Showcase Section - App Light Theme with Rich 3D Visuals */}
      <section
        className="glass-panel home-hero"
        style={{
          padding: '48px 44px',
          background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.92) 0%, rgba(250, 245, 255, 0.88) 55%, rgba(248, 250, 252, 0.92) 100%)',
          backdropFilter: 'blur(24px) saturate(180%)',
          border: '1.5px solid rgba(255, 255, 255, 0.95)',
          boxShadow: '0 20px 50px -10px rgba(124, 58, 237, 0.14), 0 4px 16px rgba(15, 23, 42, 0.05), inset 0 1px 2px rgba(255, 255, 255, 1)',
          display: 'grid',
          gridTemplateColumns: '1.25fr 0.95fr',
          gap: '40px',
          alignItems: 'center',
          position: 'relative',
          overflow: 'visible',
          borderRadius: '24px',
        }}
      >
        {/* 3D Floating Sphere Accents inside Hero */}
        <div
          className="visual-orb visual-orb-pink float-effect"
          style={{ width: '42px', height: '42px', top: '-18px', right: '40%', opacity: 0.85 }}
        />
        <div
          className="visual-orb visual-orb-cyan float-effect-slow"
          style={{ width: '32px', height: '32px', bottom: '-12px', left: '10%', opacity: 0.85 }}
        />

        {/* Subtle ambient light gradient background */}
        <div
          style={{
            position: 'absolute',
            top: '-100px',
            right: '-60px',
            width: '420px',
            height: '420px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(124, 58, 237, 0.12) 0%, transparent 70%)',
            pointerEvents: 'none',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: '-100px',
            left: '-60px',
            width: '380px',
            height: '380px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(249, 115, 22, 0.1) 0%, transparent 70%)',
            pointerEvents: 'none',
          }}
        />

        {/* Left Column: Value Prop & Actions */}
        <div style={{ position: 'relative', zIndex: 2 }}>
          {/* Top Category Badges */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
            <span className="badge badge-purple" style={{ boxShadow: '0 2px 8px rgba(124, 58, 237, 0.15)', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <img
                src="/assets/investaplay-logo.png"
                alt="InvestaPlay Studio"
                style={{ width: '13px', height: '13px', objectFit: 'contain' }}
              />
              <span>Powered by InvestaPlay Studio</span>
            </span>
            <span className="badge badge-orange" style={{ boxShadow: '0 2px 8px rgba(249, 115, 22, 0.15)' }}>
              <Cpu size={12} />
              <span>QuizzyFox AI Engine</span>
            </span>
            <span className="badge badge-green" style={{ boxShadow: '0 2px 8px rgba(16, 185, 129, 0.15)' }}>
              <Radio size={12} />
              <span>Live Season 3</span>
            </span>
          </div>

          {/* Headline */}
          <h1
            style={{
              fontFamily: 'var(--font-heading)',
              fontSize: '44px',
              fontWeight: 800,
              lineHeight: 1.15,
              letterSpacing: '-0.03em',
              color: 'var(--text-primary)',
              marginBottom: '18px',
            }}
          >
            The Ultimate AI-Powered <br />
            <span
              style={{
                background: 'linear-gradient(135deg, #7C3AED 0%, #EA580C 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              Real-Time Trivia Arena.
            </span>
            <img
              src="/assets/icon-ai-star.png"
              alt="AI"
              className="float-effect"
              style={{
                width: '34px',
                height: '34px',
                verticalAlign: 'middle',
                marginLeft: '12px',
                objectFit: 'contain',
                filter: 'drop-shadow(0 4px 10px rgba(249, 115, 22, 0.35))',
                display: 'inline-block',
              }}
            />
          </h1>

          {/* Subtitle */}
          <p
            style={{
              color: 'var(--text-secondary)',
              fontSize: '16px',
              lineHeight: 1.65,
              marginBottom: '32px',
              maxWidth: '540px',
            }}
          >
            Generate infinite quizzes on any topic or upload study PDFs in seconds.
            Challenge friends to live 1v1 duels with 15-second timers and instant score tracking.
          </p>

          {/* Primary Action Buttons with Shimmer Reflection */}
          <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', marginBottom: '36px' }}>
            {user ? (
              <>
                <Link
                  to="/quick-quiz"
                  className="btn btn-orange btn-shimmer"
                  style={{ padding: '14px 28px', fontSize: '15px', borderRadius: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                  <img
                    src="/assets/icon-ai-star.png"
                    alt=""
                    style={{ width: '20px', height: '20px', objectFit: 'contain' }}
                  />
                  <span>Launch Quick Quiz AI</span>
                </Link>
                <Link
                  to="/friends"
                  className="btn btn-secondary btn-shimmer"
                  style={{ padding: '14px 26px', fontSize: '15px', borderRadius: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                  <img
                    src="/assets/icon-swords.png"
                    alt=""
                    style={{ width: '20px', height: '20px', objectFit: 'contain' }}
                  />
                  <span>Enter 1v1 Arena</span>
                </Link>
              </>
            ) : (
              <>
                <Link
                  to="/login"
                  state={{ from: { pathname: '/quick-quiz' }, message: 'Sign In or Register to play QuizzyFox games!' }}
                  className="btn btn-primary btn-shimmer"
                  style={{ padding: '14px 30px', fontSize: '15px', borderRadius: '14px', display: 'flex', alignItems: 'center', gap: '10px' }}
                >
                  <LogIn size={18} />
                  <span>Sign In to Play Now</span>
                </Link>
                <Link
                  to="/login"
                  state={{ from: { pathname: '/friends' }, message: 'Create an account to challenge players & climb rankings!' }}
                  className="btn btn-secondary btn-shimmer"
                  style={{ padding: '14px 24px', fontSize: '15px', borderRadius: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                  <ShieldCheck size={18} color="#7C3AED" />
                  <span>Create Account</span>
                </Link>
              </>
            )}
          </div>

          {/* Live Telemetry Bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '24px',
              paddingTop: '20px',
              borderTop: '1px solid #E2E8F0',
              flexWrap: 'wrap',
            }}
          >
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)' }}>
                50,000+
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                AI Questions
              </div>
            </div>
            <div style={{ width: '1px', height: '24px', background: '#E2E8F0' }} />
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '18px', fontWeight: 800, color: '#10B981' }}>
                &lt; 15ms
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Socket Sync
              </div>
            </div>
            <div style={{ width: '1px', height: '24px', background: '#E2E8F0' }} />
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '18px', fontWeight: 800, color: '#EA580C' }}>
                15 SEC
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Blitz Timer
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Live Match Simulation Card */}
        <div style={{ display: 'flex', justifyContent: 'center', position: 'relative', zIndex: 2 }}>
          <div
            className="glass-panel"
            style={{
              width: '100%',
              maxWidth: '380px',
              background: 'rgba(255, 255, 255, 0.94)',
              border: '1.5px solid rgba(255, 255, 255, 0.95)',
              borderRadius: '20px',
              padding: '24px',
              boxShadow: '0 16px 40px -4px rgba(124, 58, 237, 0.16), 0 4px 12px rgba(15, 23, 42, 0.05)',
              position: 'relative',
            }}
          >
            {/* Simulation Header */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingBottom: '16px',
                borderBottom: '1px solid #F1F5F9',
                marginBottom: '18px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="online-indicator" />
                <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.04em' }}>
                  LIVE 1V1 DUEL
                </span>
              </div>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#C2410C',
                  background: '#FFF7ED',
                  padding: '2px 8px',
                  borderRadius: '6px',
                  fontFamily: 'var(--font-mono)',
                  border: '1px solid #FFEDD5',
                }}
              >
                ROUND 04 / 05
              </span>
            </div>

            {/* Duelists Head-to-Head */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto 1fr',
                alignItems: 'center',
                gap: '12px',
                marginBottom: '20px',
              }}
            >
              {/* Player 1 */}
              <div style={{ textAlign: 'center' }}>
                <div style={{ position: 'relative', display: 'inline-block', marginBottom: '6px' }}>
                  <img
                    src="/assets/avatars/01-young-boy.webp"
                    alt="Player 1"
                    style={{
                      width: '48px',
                      height: '48px',
                      borderRadius: '50%',
                      objectFit: 'cover',
                      border: '2px solid #7C3AED',
                    }}
                  />
                  <span
                    style={{
                      position: 'absolute',
                      bottom: '-4px',
                      right: '-4px',
                      background: '#7C3AED',
                      color: '#FFF',
                      fontSize: '9px',
                      fontWeight: 800,
                      padding: '1px 5px',
                      borderRadius: '4px',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    YOU
                  </span>
                </div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {user?.displayName || 'Challenger'}
                </div>
                <div style={{ fontSize: '15px', fontWeight: 800, color: '#7C3AED', fontFamily: 'var(--font-mono)' }}>
                  850 PTS
                </div>
              </div>

              {/* VS Pill with Timer */}
              <div style={{ textAlign: 'center' }}>
                <div
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '50%',
                    background: '#FEF3C7',
                    border: '1px solid #FDE68A',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 4px auto',
                    color: '#B45309',
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 800,
                    fontSize: '13px',
                  }}
                >
                  <Timer size={16} />
                </div>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>
                  08s
                </span>
              </div>

              {/* Opponent */}
              <div style={{ textAlign: 'center' }}>
                <div style={{ position: 'relative', display: 'inline-block', marginBottom: '6px' }}>
                  <img
                    src="/assets/avatars/02-young-girl.webp"
                    alt="Opponent"
                    style={{
                      width: '48px',
                      height: '48px',
                      borderRadius: '50%',
                      objectFit: 'cover',
                      border: '2px solid #F97316',
                    }}
                  />
                  <span
                    style={{
                      position: 'absolute',
                      bottom: '-4px',
                      right: '-4px',
                      background: '#F97316',
                      color: '#FFF',
                      fontSize: '9px',
                      fontWeight: 800,
                      padding: '1px 5px',
                      borderRadius: '4px',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    OPP
                  </span>
                </div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Nova_AI
                </div>
                <div style={{ fontSize: '15px', fontWeight: 800, color: '#EA580C', fontFamily: 'var(--font-mono)' }}>
                  720 PTS
                </div>
              </div>
            </div>

            {/* Live Question Snippet */}
            <div
              style={{
                background: '#F8FAFC',
                border: '1px solid #E2E8F0',
                borderRadius: '12px',
                padding: '12px 14px',
                marginBottom: '18px',
              }}
            >
              <div style={{ fontSize: '10px', color: '#7C3AED', fontWeight: 700, textTransform: 'uppercase', marginBottom: '4px' }}>
                TOPIC: QUANTUM MECHANICS
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-primary)', lineHeight: 1.4, margin: 0 }}>
                Which quantum phenomenon describes particles remaining connected regardless of distance?
              </p>
            </div>

            {/* Daily Streak Claim Action (No Guest Mode) */}
            {user ? (
              <button
                onClick={handleClaimStreak}
                disabled={claimedDaily || claiming}
                className="btn btn-primary"
                style={{ width: '100%', padding: '11px 16px', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
              >
                <img
                  src="/assets/icon-fire.png"
                  alt="Streak"
                  style={{ width: '20px', height: '20px', objectFit: 'contain' }}
                />
                <span>{claimedDaily ? 'Daily Bonus Collected (+50 Coins)' : 'Claim Daily Reward (+50 Coins)'}</span>
              </button>
            ) : (
              <Link
                to="/login"
                className="btn btn-primary"
                style={{ width: '100%', padding: '11px 16px', fontSize: '13px' }}
              >
                <LogIn size={15} />
                <span>Sign In to Play & Collect</span>
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* Game Modes Grid */}
      <section>
        <div style={{ marginBottom: '24px' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#7C3AED', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>
            SELECT ARENA
          </div>
          <h2
            style={{
              fontFamily: 'var(--font-heading)',
              fontWeight: 800,
              fontSize: '28px',
              color: 'var(--text-primary)',
              letterSpacing: '-0.02em',
            }}
          >
            Competitive Game Modes
          </h2>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px' }}>
          {/* Card 1: Quick Quiz AI */}
          <Link
            to="/quick-quiz"
            className="glass-panel glass-panel-hover"
            style={{
              padding: '32px 28px',
              textDecoration: 'none',
              background: 'linear-gradient(160deg, rgba(255, 247, 237, 0.88) 0%, rgba(255, 255, 255, 0.94) 100%)',
              border: '1.5px solid rgba(254, 215, 170, 0.7)',
              boxShadow: '0 14px 36px -4px rgba(249, 115, 22, 0.14), 0 2px 8px rgba(15, 23, 42, 0.04)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              borderRadius: '20px',
            }}
          >
            <div>
              <div
                className="float-effect"
                style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '16px',
                  background: 'linear-gradient(135deg, #FFEDD5 0%, #FED7AA 100%)',
                  border: '1.5px solid #FDBA74',
                  boxShadow: '0 6px 18px rgba(249, 115, 22, 0.28)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: '20px',
                }}
              >
                <img
                  src="/assets/icon-ai-star.png"
                  alt="Quick Quiz AI"
                  style={{ width: '40px', height: '40px', objectFit: 'contain' }}
                />
              </div>

              <div className="badge badge-orange" style={{ marginBottom: '12px' }}>
                Generative AI Engine
              </div>

              <h3
                style={{
                  fontFamily: 'var(--font-heading)',
                  fontSize: '22px',
                  fontWeight: 800,
                  color: 'var(--text-primary)',
                  marginBottom: '10px',
                  letterSpacing: '-0.01em',
                }}
              >
                Quick Quiz AI
              </h3>

              <p style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.6, marginBottom: '24px' }}>
                Type any subject or upload study PDFs. The intelligent AI engine formulates balanced questions with 15s timers for solo practice or live 1v1 matchmaking.
              </p>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingTop: '16px',
                borderTop: '1px solid #FED7AA',
                color: '#C2410C',
                fontWeight: 600,
                fontSize: '14px',
              }}
            >
              <span>Launch AI Arena</span>
              <ArrowRight size={17} />
            </div>
          </Link>

          {/* Card 2: Play with Friends */}
          <Link
            to="/friends"
            className="glass-panel glass-panel-hover"
            style={{
              padding: '32px 28px',
              textDecoration: 'none',
              background: 'linear-gradient(160deg, rgba(245, 243, 255, 0.88) 0%, rgba(255, 255, 255, 0.94) 100%)',
              border: '1.5px solid rgba(221, 214, 254, 0.7)',
              boxShadow: '0 14px 36px -4px rgba(124, 58, 237, 0.14), 0 2px 8px rgba(15, 23, 42, 0.04)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              borderRadius: '20px',
            }}
          >
            <div>
              <div
                className="float-effect-slow"
                style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '16px',
                  background: 'linear-gradient(135deg, #EDE9FE 0%, #DDD6FE 100%)',
                  border: '1.5px solid #C4B5FD',
                  boxShadow: '0 6px 18px rgba(124, 58, 237, 0.28)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: '20px',
                }}
              >
                <img
                  src="/assets/icon-swords.png"
                  alt="1v1 Arena"
                  style={{ width: '40px', height: '40px', objectFit: 'contain' }}
                />
              </div>

              <div className="badge badge-purple" style={{ marginBottom: '12px' }}>
                Real-Time Multiplayer
              </div>

              <h3
                style={{
                  fontFamily: 'var(--font-heading)',
                  fontSize: '22px',
                  fontWeight: 800,
                  color: 'var(--text-primary)',
                  marginBottom: '10px',
                  letterSpacing: '-0.01em',
                }}
              >
                Friends 1v1 Arena
              </h3>

              <p style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.6, marginBottom: '24px' }}>
                Generate private lobbies with 6-digit codes or challenge active players directly. Real-time synchronization keeps both screens locked on the same tick.
              </p>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingTop: '16px',
                borderTop: '1px solid #DDD6FE',
                color: '#6D28D9',
                fontWeight: 600,
                fontSize: '14px',
              }}
            >
              <span>Enter Lobby</span>
              <ArrowRight size={17} />
            </div>
          </Link>

          {/* Card 3: Global Leaderboard */}
          <Link
            to="/leaderboard"
            className="glass-panel glass-panel-hover"
            style={{
              padding: '32px 28px',
              textDecoration: 'none',
              background: 'linear-gradient(160deg, rgba(254, 243, 199, 0.88) 0%, rgba(255, 255, 255, 0.94) 100%)',
              border: '1.5px solid rgba(253, 230, 138, 0.7)',
              boxShadow: '0 14px 36px -4px rgba(245, 158, 11, 0.14), 0 2px 8px rgba(15, 23, 42, 0.04)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              borderRadius: '20px',
            }}
          >
            <div>
              <div
                className="float-effect"
                style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '16px',
                  background: 'linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%)',
                  border: '1px solid #FCD34D',
                  boxShadow: '0 6px 18px rgba(245, 158, 11, 0.28)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: '20px',
                }}
              >
                <img
                  src="/assets/trophy.png"
                  alt="Hall of Fame"
                  style={{ width: '42px', height: '42px', objectFit: 'contain' }}
                />
              </div>

              <div className="badge badge-gold" style={{ marginBottom: '12px' }}>
                Competitive Rankings
              </div>

              <h3
                style={{
                  fontFamily: 'var(--font-heading)',
                  fontSize: '22px',
                  fontWeight: 800,
                  color: 'var(--text-primary)',
                  marginBottom: '10px',
                  letterSpacing: '-0.01em',
                }}
              >
                Hall of Fame
              </h3>

              <p style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.6, marginBottom: '24px' }}>
                Track your Elo rating, win rate, and streak records against top competitors. Season 3 top champions earn rare badges and coin multipliers.
              </p>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingTop: '16px',
                borderTop: '1px solid #FDE68A',
                color: '#B45309',
                fontWeight: 600,
                fontSize: '14px',
              }}
            >
              <span>View Leaderboard</span>
              <ArrowRight size={17} />
            </div>
          </Link>
        </div>
      </section>

      {/* Online Players Radar Section */}
      <section className="glass-panel" style={{ padding: '28px 32px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '22px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span className="online-indicator" />
            <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '19px', fontWeight: 800, color: 'var(--text-primary)' }}>
              Active Competitors Online
            </h3>
            <span className="badge badge-green" style={{ fontFamily: 'var(--font-mono)' }}>
              {onlinePlayers.length} ONLINE
            </span>
          </div>

          <Link
            to="/quick-quiz"
            style={{
              color: '#7C3AED',
              fontSize: '13px',
              fontWeight: 600,
              textDecoration: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <span>Launch Quick Challenge</span>
            <ArrowRight size={14} />
          </Link>
        </div>

        {loadingPlayers ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Querying online players...</p>
        ) : onlinePlayers.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '36px 0', color: 'var(--text-muted)' }}>
            <Users size={32} style={{ marginBottom: '8px', opacity: 0.4 }} />
            <p style={{ fontSize: '14px' }}>
              No other challengers online right now. Invite a friend or open a second browser window to test 1v1 duels!
            </p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '14px' }}>
            {onlinePlayers.slice(0, 6).map((player, idx) => (
              <div
                key={player.id}
                style={{
                  background: '#F8FAFC',
                  border: '1px solid #E2E8F0',
                  borderRadius: '14px',
                  padding: '12px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  transition: 'all 0.2s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ position: 'relative' }}>
                    <img
                      src={player.avatarUrl || (idx % 2 === 0 ? '/assets/avatars/01-young-boy.webp' : '/assets/avatars/02-young-girl.webp')}
                      alt={player.displayName || player.username}
                      style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '50%',
                        objectFit: 'cover',
                        border: '1.5px solid #CBD5E1',
                      }}
                    />
                    <span
                      className="online-indicator"
                      style={{ position: 'absolute', bottom: 0, right: 0, border: '2px solid #FFFFFF' }}
                    />
                  </div>
                  <div>
                    <h4 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>
                      {player.displayName || player.username}
                    </h4>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      LVL {player.level || 1}
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => {
                    if (!user) {
                      navigate('/login', {
                        state: {
                          from: { pathname: '/quick-quiz' },
                          message: 'Please Sign In or Register to challenge players in 1v1 duels!',
                        },
                      });
                    } else {
                      navigate('/quick-quiz');
                    }
                  }}
                  className="btn btn-orange"
                  style={{ padding: '6px 12px', fontSize: '12px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <img
                    src="/assets/icon-swords.png"
                    alt=""
                    style={{ width: '15px', height: '15px', objectFit: 'contain' }}
                  />
                  <span>Duel</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
