import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Swords, Plus, Users, RefreshCw, Check, X, Copy, CheckCheck } from 'lucide-react';
import { api } from '../services/api';
import { getSocket } from '../services/socket';
import { useAuth } from '../context/AuthContext';
import { OnlinePlayer } from '../types';

export const FriendsPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [challenges, setChallenges] = useState<any[]>([]);
  const [onlinePlayers, setOnlinePlayers] = useState<OnlinePlayer[]>([]);
  const [loading, setLoading] = useState(false);
  const [roomCode, setRoomCode] = useState('');
  const [joiningRoom, setJoiningRoom] = useState(false);
  const [creatingRoom, setCreatingRoom] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [chRes, onRes] = await Promise.all([
        api.getChallenges().catch(() => ({ challenges: [] })),
        api.getOnlinePlayers().catch(() => ({ players: [] })),
      ]);
      setChallenges(chRes.challenges || []);
      setOnlinePlayers(onRes.players || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user) {
      navigate('/login', {
        state: { from: { pathname: '/friends' }, message: 'Please Sign In or Register to enter 1v1 Arena!' },
      });
    }
  }, [user, navigate]);

  useEffect(() => {
    if (user) {
      loadData();
    }
    const socket = getSocket();
    if (socket) {
      socket.on('challenge:received', loadData);
      socket.on('challenge:accepted', loadData);
      socket.on('challenge:declined', loadData);
      socket.on('challenge:cancelled', loadData);

      return () => {
        socket.off('challenge:received', loadData);
        socket.off('challenge:accepted', loadData);
        socket.off('challenge:declined', loadData);
        socket.off('challenge:cancelled', loadData);
      };
    }
  }, []);

  const handleCreateRoom = async () => {
    setCreatingRoom(true);
    try {
      const res = await api.createRoom({
        category: 'General',
        difficulty: 'medium',
        questionLimit: 5,
        isPrivate: true,
      });
      const targetRoomId = res.room?.id || (res as any)?.id || (typeof res.room === 'string' ? res.room : null);
      if (targetRoomId) {
        navigate(`/room/${targetRoomId}`);
      } else {
        throw new Error('Room created but ID was not returned');
      }
    } catch (err: any) {
      alert(err.message || 'Could not create room');
    } finally {
      setCreatingRoom(false);
    }
  };

  const handleJoinByCode = async () => {
    const cleanCode = roomCode.trim().toUpperCase();
    if (!cleanCode) {
      alert('Please enter a 6-character room code.');
      return;
    }
    setJoiningRoom(true);
    try {
      const res = await api.joinRoomByCode(cleanCode);
      const targetRoomId = res.room?.id || (res as any)?.id || (typeof res.room === 'string' ? res.room : null);
      if (targetRoomId) {
        navigate(`/room/${targetRoomId}`);
      } else {
        throw new Error('Room found but ID was not returned');
      }
    } catch (err: any) {
      alert(err.message || 'Room not found or no longer active');
    } finally {
      setJoiningRoom(false);
    }
  };

  const handleAcceptChallenge = async (id: string) => {
    try {
      const res = await api.acceptChallenge(id);
      const roomId = res.roomId || res.challenge?.room_id;
      if (roomId) {
        navigate(`/room/${roomId}`);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to accept challenge');
    }
  };

  const handleDeclineChallenge = async (id: string) => {
    try {
      await api.declineChallenge(id);
      loadData();
    } catch (_) {}
  };

  const incomingChallenges = challenges.filter(
    (c) => c.status === 'pending' && String(c.challenged_id) === String(user?.id)
  );

  return (
    <div style={{ width: '100%', maxWidth: '1640px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '32px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span className="badge badge-purple" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <img src="/assets/investaplay-logo.png" alt="InvestaPlay Studio" style={{ width: '13px', height: '13px', objectFit: 'contain' }} />
              <span>InvestaPlay Studio</span>
            </span>
            <span className="badge badge-orange" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <img src="/assets/icon-swords.png" alt="" style={{ width: '15px', height: '15px', objectFit: 'contain' }} />
              <span>Multiplayer Arena</span>
            </span>
          </div>
          <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: '36px', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '6px', letterSpacing: '-0.02em' }}>
            1v1 Arena & Private Rooms
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '15px', lineHeight: 1.5 }}>
            Battle online friends 1v1, manage incoming challenges, or enter a custom room code.
          </p>
        </div>

        <button
          onClick={loadData}
          className="btn btn-secondary"
          style={{ padding: '10px 20px', fontSize: '13px' }}
        >
          <RefreshCw size={15} className={loading ? 'pulse-glow' : ''} />
          <span>Refresh Players</span>
        </button>
      </div>

      {/* Quick Room Code Bar (Wide Full-Width) */}
      <div
        className="glass-panel"
        style={{
          padding: '28px 32px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '32px',
          alignItems: 'center',
          background: '#FFFFFF',
          border: '1.5px solid #E2E8F0',
          boxShadow: '0 8px 30px rgba(124, 58, 237, 0.05)',
        }}
      >
        <div>
          <div style={{ fontSize: '11px', fontWeight: 800, color: '#7C3AED', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>
            DIRECT JOIN
          </div>
          <h3 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '10px' }}>
            Enter a Room Code
          </h3>
          <div style={{ display: 'flex', gap: '12px' }}>
            <input
              type="text"
              placeholder="ENTER 6-DIGIT CODE"
              className="input-field"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              maxLength={8}
              style={{ textTransform: 'uppercase', letterSpacing: '3px', fontWeight: 800, fontSize: '15px', padding: '12px 18px' }}
            />
            <button
              onClick={handleJoinByCode}
              disabled={joiningRoom}
              className="btn btn-primary"
              style={{ padding: '12px 28px', flexShrink: 0, fontSize: '14px' }}
            >
              {joiningRoom ? 'Joining...' : 'Join Room'}
            </button>
          </div>
        </div>

        <div style={{ borderLeft: '1px solid #E2E8F0', paddingLeft: '32px' }}>
          <div style={{ fontSize: '11px', fontWeight: 800, color: '#EA580C', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>
            INSTANT LOBBY
          </div>
          <h3 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '10px' }}>
            Host Your Own Private Room
          </h3>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '14px' }}>
            Create a custom battle lobby with a 6-digit code to invite any friend.
          </p>
          <button
            onClick={handleCreateRoom}
            disabled={creatingRoom}
            className="btn btn-orange"
            style={{ width: '100%', padding: '13px 20px', fontSize: '14px' }}
          >
            <Plus size={18} />
            <span>{creatingRoom ? 'Creating Lobby...' : 'Create Private Room'}</span>
          </button>
        </div>
      </div>

      {/* 2-Column Dashboard: Online Players (Left) + Challenge Inbox (Right) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '28px', alignItems: 'start' }}>
        {/* Left / Main Column: Online Players to Challenge */}
        <div className="glass-panel" style={{ padding: '28px', background: '#FFFFFF', border: '1.5px solid #E2E8F0', flex: 1.5 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span className="online-indicator" />
              <h3 style={{ fontSize: '19px', fontWeight: 800, color: 'var(--text-primary)' }}>
                Online Players Available ({onlinePlayers.length})
              </h3>
            </div>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>Live Matchmaking</span>
          </div>

          {onlinePlayers.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px' }}>
              <img
                src="/assets/icon-swords.png"
                alt=""
                style={{ width: '48px', height: '48px', objectFit: 'contain', margin: '0 auto 12px auto', opacity: 0.6 }}
              />
              <h4 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>No Players Online Yet</h4>
              <p style={{ color: 'var(--text-muted)', fontSize: '13px', maxWidth: '380px', margin: '0 auto' }}>
                Open another tab or share your room code with friends to challenge them in real-time!
              </p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
              {onlinePlayers.map((player) => (
                <div
                  key={player.id}
                  className="glass-panel glass-panel-hover"
                  style={{
                    background: '#F8FAFC',
                    border: '1px solid #E2E8F0',
                    borderRadius: '16px',
                    padding: '16px 18px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    boxShadow: '0 2px 8px rgba(15, 23, 42, 0.03)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ position: 'relative' }}>
                      <img
                        src={player.avatar || `/assets/avatars/0${(player.id ? (player.id.charCodeAt(0) % 8) + 1 : 1)}-young-boy.webp`}
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).src = '/assets/avatar-boy.png';
                        }}
                        alt={player.displayName || player.username}
                        style={{
                          width: '44px',
                          height: '44px',
                          borderRadius: '50%',
                          objectFit: 'cover',
                          border: '2px solid var(--border-light)',
                          display: 'block',
                        }}
                      />
                      <span
                        className="online-indicator"
                        style={{ position: 'absolute', bottom: 0, right: 0, border: '2px solid #FFFFFF' }}
                      />
                    </div>
                    <div>
                      <h4 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {player.displayName || player.username}
                      </h4>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Lvl {player.level || 1} • Ready</span>
                    </div>
                  </div>

                  <button
                    onClick={() => navigate('/quick-quiz')}
                    className="btn btn-orange"
                    style={{ padding: '8px 14px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <img
                      src="/assets/icon-swords.png"
                      alt=""
                      style={{ width: '14px', height: '14px', objectFit: 'contain' }}
                    />
                    <span>Duel</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Column: Challenge Inbox */}
        <div className="glass-panel" style={{ padding: '28px', background: '#FFFFFF', border: '1.5px solid #E2E8F0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h3 style={{ fontSize: '19px', fontWeight: 800, color: 'var(--text-primary)' }}>
              Challenge Inbox
            </h3>
            <span className="badge badge-purple" style={{ fontSize: '11px', fontWeight: 800 }}>
              {incomingChallenges.length} PENDING
            </span>
          </div>

          {incomingChallenges.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '36px 16px', color: 'var(--text-muted)' }}>
              <img
                src="/assets/quizzyfox.png"
                alt="QuizzyFox"
                style={{ width: '48px', height: '48px', objectFit: 'contain', margin: '0 auto 10px auto', opacity: 0.7 }}
              />
              <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                No Pending Challenges
              </p>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                When an opponent challenges you, it will pop up here with real-time sound alert!
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {incomingChallenges.map((ch) => (
                <div
                  key={ch.id}
                  style={{
                    background: '#F8FAFC',
                    border: '1.5px solid #EDE9FE',
                    borderRadius: '16px',
                    padding: '16px 18px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                  }}
                >
                  <div>
                    <h4 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
                      ⚡ {ch.challenger_name || 'A Player'} challenged you!
                    </h4>
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      Topic: {ch.topic || 'General AI Quiz'} • {ch.question_limit || 5} Questions
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                      onClick={() => handleDeclineChallenge(ch.id)}
                      className="btn btn-secondary"
                      style={{ flex: 1, padding: '9px 12px', fontSize: '12px' }}
                    >
                      Decline
                    </button>
                    <button
                      onClick={() => handleAcceptChallenge(ch.id)}
                      className="btn btn-primary"
                      style={{ flex: 1.5, padding: '9px 16px', fontSize: '12px' }}
                    >
                      Accept & Play
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
