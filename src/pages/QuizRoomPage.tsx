import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Swords, Check, Crown, Users, LogOut, Play, Copy, CheckCheck } from 'lucide-react';
import { api } from '../services/api';
import { getSocket } from '../services/socket';
import { useAuth } from '../context/AuthContext';
import { Room } from '../types';

export const QuizRoomPage: React.FC = () => {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isReady, setIsReady] = useState(false);
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!user) {
      navigate('/login', {
        state: { from: { pathname: `/room/${roomId}` }, message: 'Please Sign In or Register to enter quiz rooms!' },
      });
    }
  }, [user, roomId, navigate]);

  useEffect(() => {
    if (!roomId) return;
    const socket = getSocket();

    const fetchRoom = async () => {
      try {
        const res = await api.getRoom(roomId);
        setRoom(res.room);
        const playerList = res.players || res.room?.players || [];
        setPlayers(playerList);
        const me = playerList.find((p: any) => String(p.id || p.user_id) === String(user?.id));
        if (me) {
          setIsReady(Boolean(me.ready ?? me.is_ready));
        }
      } catch (err: any) {
        console.error('Failed to load room:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchRoom();

    if (socket) {
      socket.emit('room:join', { roomId }, (reply: any) => {
        console.log('[Room Join] Reply:', reply);
        if (reply && !reply.ok) {
          console.warn('[Room Join] failed:', reply.error);
        }
      });

      const handleRoomUpdated = (payload: any) => {
        console.log('[Room Updated]:', payload);
        const updatedRoom = payload?.room || payload;
        setRoom(updatedRoom);
        const playerList = payload?.players || updatedRoom?.players || [];
        if (playerList.length > 0) {
          setPlayers(playerList);
          const me = playerList.find((p: any) => String(p.id || p.user_id) === String(user?.id));
          if (me) {
            setIsReady(Boolean(me.ready ?? me.is_ready));
          }
        }
      };

      const handleGameStarting = (payload: any) => {
        console.log('[Game Starting]:', payload);
        const gameId = payload?.gameId || payload?.game?.id;
        navigate('/game', {
          state: {
            gameId,
            roomId,
            isMultiplayer: true,
          },
        });
      };

      const handleRoomCancelled = () => {
        alert('Match cancelled: A player left the lobby.');
        navigate('/friends');
      };

      socket.on('room:updated', handleRoomUpdated);
      socket.on('game:starting', handleGameStarting);
      socket.on('room:game_started', handleGameStarting);
      socket.on('room:cancelled', handleRoomCancelled);
      socket.on('challenge:cancelled', handleRoomCancelled);

      return () => {
        // Unbind listeners on component unmount without killing the room for other players
        socket.off('room:updated', handleRoomUpdated);
        socket.off('game:starting', handleGameStarting);
        socket.off('room:game_started', handleGameStarting);
        socket.off('room:cancelled', handleRoomCancelled);
        socket.off('challenge:cancelled', handleRoomCancelled);
      };
    }
  }, [roomId, user, navigate]);

  const handleToggleReady = async () => {
    if (!roomId) return;
    const nextReady = !isReady;
    setIsReady(nextReady);
    const socket = getSocket();
    if (socket) {
      socket.emit('room:ready', { roomId, ready: nextReady });
    }
    try {
      await api.toggleRoomReady(roomId, nextReady);
    } catch (e) {
      // socket handled state
    }
  };

  const handleStartGame = async () => {
    if (!roomId || starting) return;
    setStarting(true);
    const socket = getSocket();
    if (socket) {
      socket.emit('room:start', { roomId }, async (reply: any) => {
        if (reply && !reply.ok) {
          // Fallback to REST endpoint
          try {
            const res = await api.startRoomGame(roomId);
            if (res?.game?.id) {
              navigate('/game', {
                state: {
                  gameId: res.game.id,
                  roomId,
                  isMultiplayer: true,
                },
              });
              return;
            }
          } catch (err: any) {
            alert(reply.error || err.message || 'Could not start game');
            setStarting(false);
          }
        }
      });
    } else {
      try {
        const res = await api.startRoomGame(roomId);
        if (res?.game?.id) {
          navigate('/game', {
            state: {
              gameId: res.game.id,
              roomId,
              isMultiplayer: true,
            },
          });
        }
      } catch (err: any) {
        alert(err.message || 'Could not start game');
        setStarting(false);
      }
    }
  };

  const handleLeaveLobby = async () => {
    const socket = getSocket();
    if (socket && roomId) {
      socket.emit('room:leave', { roomId });
    }
    try {
      if (roomId) await api.leaveRoom(roomId);
    } catch {}
    navigate('/friends');
  };

  const handleCopyCode = () => {
    if (room?.code) {
      navigator.clipboard.writeText(room.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '100px 0', color: 'var(--text-muted)' }}>
        <p style={{ fontSize: '18px' }}>Entering waiting lobby...</p>
      </div>
    );
  }

  const isHost = String(room?.host_user_id) === String(user?.id);
  const allReady =
    players.length >= 2 &&
    players.every((p: any) => {
      const isPlayerHost = p.role === 'host' || String(p.id || p.user_id) === String(room?.host_user_id);
      return isPlayerHost || Boolean(p.ready ?? p.is_ready);
    });

  return (
    <div style={{ width: '100%', maxWidth: '1440px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '32px' }}>
      {/* Lobby Header */}
      <div className="glass-panel" style={{ padding: '32px 28px', textAlign: 'center', borderRadius: '20px' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <span className="badge badge-purple" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <img src="/assets/icon-swords.png" alt="" style={{ width: '15px', height: '15px', objectFit: 'contain' }} />
            <span>1v1 Battle Lobby</span>
          </span>
          <span className="badge badge-purple" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <img src="/assets/investaplay-logo.png" alt="InvestaPlay Studio" style={{ width: '13px', height: '13px', objectFit: 'contain' }} />
            <span>InvestaPlay Studio</span>
          </span>
        </div>
        <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: '32px', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '8px', letterSpacing: '-0.02em' }}>
          {(room as any)?.room_name || room?.category || 'AI Battle Match'}
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '18px', maxWidth: '540px', margin: '0 auto 18px auto', lineHeight: 1.5 }}>
          Standard 15s blitz timer. Both players must mark Ready before the match can begin.
        </p>

        {/* Room Code */}
        {room?.code && (
          <div
            onClick={handleCopyCode}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '10px',
              background: '#F1F5F9',
              border: '1px solid var(--border-light)',
              borderRadius: '12px',
              padding: '8px 18px',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <span style={{ color: 'var(--text-muted)', fontSize: '12px', fontWeight: 600, letterSpacing: '0.04em' }}>ROOM CODE:</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '18px', fontWeight: 700, letterSpacing: '2px', color: 'var(--primary)' }}>
              {room.code}
            </span>
            {copied ? <CheckCheck size={16} color="#10B981" /> : <Copy size={16} color="var(--text-muted)" />}
          </div>
        )}
      </div>

      {/* Players in Room */}
      <div className="glass-panel" style={{ padding: '28px' }}>
        <h3 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '20px' }}>
          Players in Lobby ({players.length}/{room?.max_players || 2})
        </h3>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          {players.map((p: any, idx: number) => {
            const isPlayerHost = p.role === 'host' || String(p.id || p.user_id) === String(room?.host_user_id);
            const readyState = isPlayerHost || Boolean(p.ready ?? p.is_ready);

            return (
              <div
                key={p.id || p.user_id || idx}
                style={{
                  background: '#FFFFFF',
                  border: readyState ? '1.5px solid #10B981' : '1px solid var(--border-light)',
                  borderRadius: '18px',
                  padding: '24px',
                  textAlign: 'center',
                  boxShadow: readyState ? '0 4px 16px rgba(16, 185, 129, 0.15)' : '0 2px 8px rgba(15, 23, 42, 0.04)',
                  transition: 'var(--transition-fast)',
                }}
              >
                <div style={{ position: 'relative', width: '72px', height: '72px', margin: '0 auto 12px auto' }}>
                  <img
                    src={p.avatar_url || p.avatarUrl || p.avatar || (idx === 0 ? '/assets/avatar-boy.png' : '/assets/avatar-girl.png')}
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).src = '/assets/avatar-boy.png';
                    }}
                    alt="Player Avatar"
                    style={{
                      width: '72px',
                      height: '72px',
                      borderRadius: '50%',
                      objectFit: 'cover',
                      border: readyState ? '2px solid #10B981' : '2px solid var(--border-light)',
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      bottom: '-4px',
                      right: '-4px',
                      borderRadius: '50%',
                      width: '24px',
                      height: '24px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden',
                      boxShadow: '0 2px 6px rgba(0, 0, 0, 0.25)',
                      background: '#FFFFFF',
                      border: '1.5px solid #FFFFFF',
                    }}
                  >
                    <img
                      src={isPlayerHost ? '/assets/trophy.png' : '/assets/icon-swords.png'}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', marginBottom: '4px' }}>
                  <h4 style={{ fontSize: '17px', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {p.displayName || p.display_name || p.username}
                  </h4>
                  {isPlayerHost && (
                    <img
                      src="/assets/trophy.png"
                      alt="Host"
                      style={{ width: '16px', height: '16px', objectFit: 'contain' }}
                    />
                  )}
                </div>

                <span style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '14px' }}>
                  Lvl {p.level || 1} • {isPlayerHost ? 'Host (Ready)' : (readyState ? 'Ready' : 'Waiting')}
                </span>

                <div
                  className={readyState ? 'badge badge-green' : 'badge'}
                  style={{
                    backgroundColor: readyState ? 'rgba(16, 185, 129, 0.12)' : '#F1F5F9',
                    color: readyState ? '#059669' : 'var(--text-muted)',
                  }}
                >
                  {readyState ? 'READY FOR BATTLE' : 'NOT READY'}
                </div>
              </div>
            );
          })}

          {/* Empty slot placeholder if waiting for player */}
          {players.length < 2 && (
            <div
              style={{
                border: '2px dashed var(--border-light)',
                background: '#FAF5FF',
                borderRadius: '18px',
                padding: '24px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-muted)',
              }}
            >
              <img
                src="/assets/quizzyfox.png"
                alt="QuizzyFox"
                style={{
                  width: '56px',
                  height: '56px',
                  objectFit: 'contain',
                  marginBottom: '10px',
                  opacity: 0.8,
                }}
                className="pulse-glow"
              />
              <h4 style={{ fontSize: '15px', color: 'var(--text-primary)', marginBottom: '4px', fontWeight: 700 }}>Waiting for Opponent...</h4>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Share room code with your friend to play together</p>
            </div>
          )}
        </div>
      </div>

      {/* Control Buttons */}
      <div style={{ display: 'flex', gap: '14px' }}>
        <button onClick={handleLeaveLobby} className="btn btn-secondary" style={{ flex: 1, padding: '16px' }}>
          <LogOut size={18} /> Leave Lobby
        </button>

        <button
          onClick={handleToggleReady}
          className={isReady ? 'btn btn-success' : 'btn btn-primary'}
          style={{ flex: 1, padding: '16px' }}
        >
          <Check size={18} />
          {isReady ? 'Mark as Not Ready' : 'Ready Up! ⚡'}
        </button>

        {isHost && (
          <button
            onClick={handleStartGame}
            disabled={!allReady || starting}
            className="btn btn-orange"
            style={{ flex: 1.5, padding: '16px' }}
          >
            <Play size={18} />
            {starting ? 'Starting Match...' : 'START MATCH 🚀'}
          </button>
        )}
      </div>
    </div>
  );
};
