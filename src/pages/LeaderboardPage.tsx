import React, { useState, useEffect } from 'react';
import { Trophy, Medal, Award, Flame, Zap } from 'lucide-react';
import { api } from '../services/api';

export const LeaderboardPage: React.FC = () => {
  const [period, setPeriod] = useState<'weekly' | 'all-time'>('weekly');
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      setLoading(true);
      try {
        const res = await api.getLeaderboard(period);
        setLeaderboard(res.leaderboard || []);
      } catch (err) {
        console.warn('Failed to load leaderboard:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchLeaderboard();
  }, [period]);

  const topThree = leaderboard.slice(0, 3);
  const remaining = leaderboard.slice(3);

  return (
    <div style={{ width: '100%', maxWidth: '1440px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '36px' }}>
      {/* Title */}
      <div style={{ textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
          <span className="badge badge-gold" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <img
              src="/assets/trophy.png"
              alt=""
              style={{ width: '15px', height: '15px', objectFit: 'contain' }}
            />
            <span>Global Hall of Fame</span>
          </span>
          <span className="badge badge-purple" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <img
              src="/assets/investaplay-logo.png"
              alt="InvestaPlay Studio"
              style={{ width: '13px', height: '13px', objectFit: 'contain' }}
            />
            <span>InvestaPlay Studio</span>
          </span>
        </div>
        <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: '36px', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '8px', letterSpacing: '-0.02em' }}>
          Competitive Leaderboards
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '15px', maxWidth: '580px', margin: '0 auto', lineHeight: 1.6 }}>
          Compete in live battles & AI trivia drills to climb the Elo leaderboard and secure exclusive season rewards.
        </p>

        {/* Period Filter Tabs */}
        <div
          style={{
            display: 'inline-flex',
            background: '#F1F5F9',
            borderRadius: '12px',
            padding: '4px',
            marginTop: '20px',
            border: '1px solid var(--border-light)',
          }}
        >
          <button
            onClick={() => setPeriod('weekly')}
            style={{
              padding: '8px 20px',
              borderRadius: '9px',
              border: 'none',
              background: period === 'weekly' ? 'var(--purple-gradient)' : 'transparent',
              color: period === 'weekly' ? '#FFFFFF' : 'var(--text-secondary)',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            Weekly Rankings
          </button>
          <button
            onClick={() => setPeriod('all-time')}
            style={{
              padding: '8px 20px',
              borderRadius: '9px',
              border: 'none',
              background: period === 'all-time' ? 'var(--purple-gradient)' : 'transparent',
              color: period === 'all-time' ? '#FFFFFF' : 'var(--text-secondary)',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            All-Time Legends
          </button>
        </div>
      </div>

      {/* Top 3 Podium Cards */}
      {topThree.length >= 3 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.15fr 1fr', gap: '16px', alignItems: 'flex-end' }}>
          {/* 2nd Place */}
          <div
            className="glass-panel"
            style={{
              padding: '24px 16px',
              textAlign: 'center',
              border: '1.5px solid #CBD5E1',
              background: 'linear-gradient(180deg, #F8FAFC 0%, #FFFFFF 100%)',
              boxShadow: '0 4px 16px rgba(15, 23, 42, 0.05)',
            }}
          >
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>🥈</div>
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
              {topThree[1]?.display_name || topThree[1]?.username}
            </h3>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '8px' }}>
              Level {topThree[1]?.level || 1}
            </span>
            <div style={{ fontSize: '15px', fontWeight: 800, color: '#475569' }}>
              {topThree[1]?.xp || topThree[1]?.score || 0} XP
            </div>
          </div>

          {/* 1st Place (Winner) */}
          <div
            className="glass-panel float-effect"
            style={{
              padding: '32px 20px',
              textAlign: 'center',
              border: '2px solid rgba(245, 158, 11, 0.4)',
              background: 'linear-gradient(180deg, #FEF3C7 0%, #FFFFFF 100%)',
              boxShadow: '0 8px 30px rgba(245, 158, 11, 0.15)',
            }}
          >
            <div style={{ marginBottom: '8px' }}>
              <img
                src="/assets/live-trophy.png"
                alt="Leaderboard Trophy"
                style={{
                  width: '64px',
                  height: '64px',
                  objectFit: 'contain',
                  margin: '0 auto',
                  filter: 'drop-shadow(0 4px 12px rgba(245, 158, 11, 0.4))',
                }}
              />
            </div>
            <h3 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '4px' }}>
              {topThree[0]?.display_name || topThree[0]?.username}
            </h3>
            <span style={{ fontSize: '13px', color: '#D97706', display: 'block', marginBottom: '10px', fontWeight: 600 }}>
              Grandmaster • Lvl {topThree[0]?.level || 1}
            </span>
            <div style={{ fontSize: '20px', fontWeight: 900, color: '#D97706' }}>
              {topThree[0]?.xp || topThree[0]?.score || 0} XP
            </div>
          </div>

          {/* 3rd Place */}
          <div
            className="glass-panel"
            style={{
              padding: '24px 16px',
              textAlign: 'center',
              border: '1.5px solid rgba(249, 115, 22, 0.3)',
              background: 'linear-gradient(180deg, #FFEDD5 0%, #FFFFFF 100%)',
              boxShadow: '0 4px 16px rgba(15, 23, 42, 0.05)',
            }}
          >
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>🥉</div>
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
              {topThree[2]?.display_name || topThree[2]?.username}
            </h3>
            <span style={{ fontSize: '12px', color: '#EA580C', display: 'block', marginBottom: '8px', fontWeight: 600 }}>
              Level {topThree[2]?.level || 1}
            </span>
            <div style={{ fontSize: '15px', fontWeight: 800, color: '#EA580C' }}>
              {topThree[2]?.xp || topThree[2]?.score || 0} XP
            </div>
          </div>
        </div>
      )}

      {/* Global Rankings Table */}
      <div className="glass-panel" style={{ padding: '24px' }}>
        <h3 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '16px' }}>
          Leaderboard Rankings
        </h3>

        {loading ? (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '30px 0' }}>Loading rankings...</p>
        ) : leaderboard.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '30px 0' }}>No players found yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {leaderboard.map((item, idx) => {
              const rank = idx + 1;
              return (
                <div
                  key={item.id || idx}
                  style={{
                    background: rank <= 3 ? '#FAF5FF' : '#FFFFFF',
                    border: '1px solid var(--border-light)',
                    borderRadius: '12px',
                    padding: '12px 18px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.03)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <div
                      style={{
                        width: '32px',
                        fontWeight: 800,
                        fontSize: '15px',
                        color: rank === 1 ? '#D97706' : rank === 2 ? '#64748B' : rank === 3 ? '#EA580C' : 'var(--text-muted)',
                      }}
                    >
                      #{rank}
                    </div>

                    <img
                      src={item.avatar || `/assets/avatars/0${(idx % 8) + 1}-young-boy.webp`}
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).src = '/assets/avatar-boy.png';
                      }}
                      alt={item.display_name || item.username}
                      style={{
                        width: '38px',
                        height: '38px',
                        borderRadius: '50%',
                        objectFit: 'cover',
                        border: '1.5px solid var(--border-light)',
                      }}
                    />

                    <div>
                      <h4 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {item.display_name || item.username}
                      </h4>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Level {item.level || 1}</span>
                    </div>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontWeight: 800, fontSize: '15px', color: 'var(--primary)' }}>
                      {item.xp || item.score || 0} XP
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
