import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles,
  Swords,
  Upload,
  FileText,
  Search,
  RefreshCw,
  Check,
  Clock,
  Trophy,
  Zap,
  Users,
  Compass,
  X,
} from 'lucide-react';
import { api } from '../services/api';
import { getSocket } from '../services/socket';
import { useAuth } from '../context/AuthContext';
import { OnlinePlayer } from '../types';

const POPULAR_TOPICS = [
  'Indian History',
  'Machine Learning & AI',
  'Cricket World Cup',
  'Space Exploration',
  'World Geography',
  'Python & JavaScript',
  'Financial Markets',
  'Ancient Rome',
];

export const QuickQuizPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Mode: 'solo' | 'challenge'
  const [gameMode, setGameMode] = useState<'solo' | 'challenge'>('solo');

  // Quiz config
  const [sourceType, setSourceType] = useState<'topic' | 'pdf'>('topic');
  const [topic, setTopic] = useState('');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [questionCount, setQuestionCount] = useState<number>(5);

  // Online Players State
  const [onlinePlayers, setOnlinePlayers] = useState<OnlinePlayer[]>([]);
  const [loadingPlayers, setLoadingPlayers] = useState(false);
  const [playerSearchText, setPlayerSearchText] = useState('');
  const [selectedOpponent, setSelectedOpponent] = useState<OnlinePlayer | null>(null);

  // In-flight challenge state
  const [isChallenging, setIsChallenging] = useState(false);
  const [activeChallengeId, setActiveChallengeId] = useState<string | null>(null);
  const [waitingOpponent, setWaitingOpponent] = useState<OnlinePlayer | null>(null);
  const [challengeStatusMessage, setChallengeStatusMessage] = useState('Generating AI questions...');
  const [waitingModalVisible, setWaitingModalVisible] = useState(false);

  useEffect(() => {
    if (!user) {
      navigate('/login', {
        state: { from: { pathname: '/quick-quiz' }, message: 'Please Sign In or Register to play Quick Quiz AI!' },
      });
    }
  }, [user, navigate]);

  // Load online players
  const loadOnlinePlayers = async () => {
    setLoadingPlayers(true);
    try {
      const res = await api.getOnlinePlayers();
      setOnlinePlayers(res.players || []);
    } catch (err) {
      console.warn('Failed to fetch online players:', err);
    } finally {
      setLoadingPlayers(false);
    }
  };

  useEffect(() => {
    if (gameMode === 'challenge') {
      loadOnlinePlayers();
    }
  }, [gameMode]);

  // Socket listener for challenge acceptance/decline
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleChallengeAccepted = (payload: any) => {
      console.log('[QuickQuiz Web] challenge:accepted:', payload);
      const roomId = payload?.roomId || payload?.data?.roomId;
      const chId = payload?.challengeId || payload?.data?.challengeId || payload?.challenge?.id;

      if (roomId && (!activeChallengeId || activeChallengeId === chId || waitingModalVisible)) {
        setWaitingModalVisible(false);
        setIsChallenging(false);
        setActiveChallengeId(null);
        navigate(`/room/${roomId}`);
      }
    };

    const handleChallengeDeclined = (payload: any) => {
      const chId = payload?.challengeId || payload?.data?.challengeId;
      if (!activeChallengeId || activeChallengeId === chId || waitingModalVisible) {
        setWaitingModalVisible(false);
        setIsChallenging(false);
        setActiveChallengeId(null);
        alert(`${waitingOpponent?.displayName || 'The player'} declined your challenge.`);
      }
    };

    const handleChallengeCancelled = (payload: any) => {
      const chId = payload?.challengeId || payload?.data?.challengeId;
      if (!activeChallengeId || activeChallengeId === chId || waitingModalVisible) {
        setWaitingModalVisible(false);
        setIsChallenging(false);
        setActiveChallengeId(null);
      }
    };

    socket.on('challenge:accepted', handleChallengeAccepted);
    socket.on('challenge:declined', handleChallengeDeclined);
    socket.on('challenge:cancelled', handleChallengeCancelled);

    return () => {
      socket.off('challenge:accepted', handleChallengeAccepted);
      socket.off('challenge:declined', handleChallengeDeclined);
      socket.off('challenge:cancelled', handleChallengeCancelled);
    };
  }, [activeChallengeId, waitingModalVisible, waitingOpponent, navigate]);

  // Start Solo Game
  const handleStartSolo = async () => {
    let finalTopic = topic.trim();
    if (sourceType === 'topic' && !finalTopic) {
      finalTopic = 'General Knowledge';
      setTopic('General Knowledge');
    }

    if (sourceType === 'pdf' && !pdfFile) {
      alert('Please select a PDF file first!');
      return;
    }

    setIsChallenging(true);
    setChallengeStatusMessage('Generating custom AI quiz questions...');
    setWaitingModalVisible(true);

    try {
      let resultQuestions: any[] = [];
      let sessionId = '';

      if (sourceType === 'topic') {
        const res = await api.generateTopicQuiz({
          topic: finalTopic,
          difficulty,
          questionCount,
        });
        resultQuestions = res.questions;
        sessionId = res.sessionId;
      } else if (pdfFile) {
        const res = await api.uploadPdfQuiz(pdfFile, difficulty, questionCount);
        resultQuestions = res.questions;
        sessionId = res.sessionId;
      }

      setWaitingModalVisible(false);
      setIsChallenging(false);

      // Navigate to GamePage with generated questions
      navigate('/game', {
        state: {
          questions: resultQuestions,
          topic: finalTopic || pdfFile?.name || 'Quick Quiz',
          difficulty,
          isSolo: true,
          sessionId,
        },
      });
    } catch (err: any) {
      setWaitingModalVisible(false);
      setIsChallenging(false);
      alert(err.message || 'Failed to generate AI quiz.');
    }
  };

  // Start 1v1 Challenge
  const handleStartChallenge = async (directOpponent?: OnlinePlayer) => {
    const target = directOpponent || selectedOpponent;
    if (!target) {
      alert('Please select an online player to challenge.');
      return;
    }

    if (directOpponent && directOpponent.id !== selectedOpponent?.id) {
      setSelectedOpponent(directOpponent);
    }

    let finalTopic = topic.trim();
    if (sourceType === 'topic' && !finalTopic) {
      finalTopic = 'General Knowledge';
      setTopic('General Knowledge');
    }

    if (sourceType === 'pdf' && !pdfFile) {
      alert('Please upload a PDF document first.');
      return;
    }

    setIsChallenging(true);
    setWaitingOpponent(target);
    setChallengeStatusMessage('Generating AI questions & preparing battle...');
    setWaitingModalVisible(true);

    try {
      let sessionIdToUse: string | undefined = undefined;

      if (sourceType === 'pdf' && pdfFile) {
        setChallengeStatusMessage('Extracting concepts from PDF with AI...');
        const pdfResult = await api.uploadPdfQuiz(pdfFile, difficulty, questionCount);
        sessionIdToUse = pdfResult.sessionId;
        finalTopic = pdfFile.name;
      }

      setChallengeStatusMessage(`Sending challenge to ${target.displayName}...`);

      const res = await api.createQuickQuizChallenge({
        targetUserId: target.id,
        sourceType,
        topic: finalTopic || 'Quick Quiz AI',
        difficulty,
        questionCount,
        sessionId: sessionIdToUse,
      });

      if (res && res.challenge?.id) {
        setActiveChallengeId(res.challenge.id);
        setChallengeStatusMessage(`Challenge Sent! Waiting for ${target.displayName} to accept...`);
      } else {
        throw new Error(res.message || 'Could not send challenge.');
      }
    } catch (err: any) {
      setWaitingModalVisible(false);
      setIsChallenging(false);
      if (err?.code === 'FRIEND_PAIR_BUSY' || err?.message?.includes('already exists')) {
        alert('An active challenge already exists between you two.');
      } else {
        alert(err.message || 'Failed to send challenge');
      }
    }
  };

  const handleCancelChallenge = async () => {
    if (activeChallengeId) {
      try {
        await api.cancelChallenge(activeChallengeId);
      } catch (_) {}
    }
    setWaitingModalVisible(false);
    setIsChallenging(false);
    setActiveChallengeId(null);
  };

  const filteredPlayers = onlinePlayers.filter((p) => {
    if (!playerSearchText.trim()) return true;
    const q = playerSearchText.toLowerCase();
    return p.displayName?.toLowerCase().includes(q) || p.username?.toLowerCase().includes(q);
  });

  return (
    <div style={{ width: '100%', maxWidth: '1640px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '32px' }}>
      {/* Title Header */}
      <div style={{ textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginBottom: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
          <span className="badge badge-purple" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <img
              src="/assets/investaplay-logo.png"
              alt="InvestaPlay Studio"
              style={{ width: '13px', height: '13px', objectFit: 'contain' }}
            />
            <span>Powered by InvestaPlay Studio</span>
          </span>
          <span className="badge badge-orange" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <img
              src="/assets/icon-ai-star.png"
              alt=""
              style={{ width: '16px', height: '16px', objectFit: 'contain' }}
            />
            <span>QuizzyFox AI Engine</span>
          </span>
        </div>
        <h1
          style={{
            fontFamily: 'var(--font-heading)',
            fontSize: '38px',
            fontWeight: 800,
            letterSpacing: '-0.02em',
            color: 'var(--text-primary)',
            marginBottom: '8px',
          }}
        >
          Quick Quiz AI Arena
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '15px', maxWidth: '600px', margin: '0 auto', lineHeight: 1.6 }}>
          Generate custom quizzes on any topic in milliseconds or upload study PDFs. Challenge online opponents to live 1v1 duels with instant WebSockets synchronization.
        </p>
      </div>

      {/* Mode Switcher: Solo vs 1v1 Challenge */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '16px',
        }}
      >
        <div
          onClick={() => setGameMode('solo')}
          className="glass-panel"
          style={{
            padding: '22px 24px',
            cursor: 'pointer',
            border: gameMode === 'solo' ? '1.5px solid var(--primary)' : '1px solid var(--border-subtle)',
            backgroundColor: gameMode === 'solo' ? '#FAF5FF' : 'var(--bg-card)',
            boxShadow: gameMode === 'solo' ? '0 8px 24px rgba(124, 58, 237, 0.12)' : 'none',
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            transition: 'all 0.2s ease',
            borderRadius: '16px',
          }}
        >
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              background: gameMode === 'solo' ? 'var(--purple-gradient)' : 'rgba(124, 58, 237, 0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <img
              src="/assets/icon-ai-star.png"
              alt="Solo Practice"
              style={{ width: '32px', height: '32px', objectFit: 'contain' }}
            />
          </div>
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '3px' }}>Solo Practice</h3>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Instant speed drill against the 15-second clock</p>
          </div>
        </div>

        <div
          onClick={() => setGameMode('challenge')}
          className="glass-panel"
          style={{
            padding: '22px 24px',
            cursor: 'pointer',
            border: gameMode === 'challenge' ? '1.5px solid var(--secondary)' : '1px solid var(--border-subtle)',
            backgroundColor: gameMode === 'challenge' ? '#FFF7ED' : 'var(--bg-card)',
            boxShadow: gameMode === 'challenge' ? '0 8px 24px rgba(249, 115, 22, 0.12)' : 'none',
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            transition: 'all 0.2s ease',
            borderRadius: '16px',
          }}
        >
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              background: gameMode === 'challenge' ? 'var(--orange-gradient)' : 'rgba(249, 115, 22, 0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <img
              src="/assets/icon-swords.png"
              alt="1v1 Live Duel"
              style={{ width: '32px', height: '32px', objectFit: 'contain' }}
            />
          </div>
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '3px' }}>
              1v1 Live Duel
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              Real-time synchronous battle with live scoreboards
            </p>
          </div>
        </div>
      </div>

      {/* Online Players Section (When in 1v1 Mode) */}
      {gameMode === 'challenge' && (
        <div className="glass-panel" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="online-indicator" />
              <h3 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)' }}>Online Players</h3>
              <span className="badge badge-green">{onlinePlayers.length} Online</span>
            </div>
            <button
              onClick={loadOnlinePlayers}
              className="btn btn-secondary"
              style={{ padding: '6px 12px', fontSize: '12px' }}
            >
              <RefreshCw size={13} className={loadingPlayers ? 'pulse-glow' : ''} />
              Refresh
            </button>
          </div>

          {/* Search Box */}
          <div style={{ position: 'relative', marginBottom: '16px' }}>
            <Search size={18} color="var(--text-muted)" style={{ position: 'absolute', left: '16px', top: '15px' }} />
            <input
              type="text"
              placeholder="Search players by name..."
              className="input-field"
              style={{ paddingLeft: '44px' }}
              value={playerSearchText}
              onChange={(e) => setPlayerSearchText(e.target.value)}
            />
          </div>

          {/* Players List */}
          {filteredPlayers.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)' }}>
              <Users size={32} style={{ marginBottom: '8px', opacity: 0.5 }} />
              <p>No other players online right now. Tap Refresh or open another tab to test 1v1!</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '12px' }}>
              {filteredPlayers.map((player) => {
                const isSelected = selectedOpponent?.id === player.id;
                return (
                  <div
                    key={player.id}
                    onClick={() => setSelectedOpponent(player)}
                    style={{
                      background: isSelected ? 'rgba(249, 115, 22, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                      border: isSelected ? '1.5px solid #F97316' : '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: '14px',
                      padding: '12px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      transition: 'var(--transition-fast)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{ position: 'relative' }}>
                        <img
                          src={player.avatar || `/assets/avatars/0${(player.id ? (player.id.charCodeAt(0) % 8) + 1 : 1)}-young-boy.webp`}
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).src = '/assets/avatar-boy.png';
                          }}
                          alt={player.displayName}
                          style={{
                            width: '38px',
                            height: '38px',
                            borderRadius: '50%',
                            objectFit: 'cover',
                            border: '1.5px solid var(--border-light)',
                            display: 'block',
                          }}
                        />
                        <span
                          className="online-indicator"
                          style={{ position: 'absolute', bottom: 0, right: 0, border: '2px solid #FFFFFF' }}
                        />
                      </div>
                      <div>
                        <h4 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
                          {player.displayName || player.username}
                        </h4>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Lvl {player.level || 1}</span>
                      </div>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleStartChallenge(player);
                      }}
                      className="btn btn-orange"
                      style={{ padding: '6px 12px', fontSize: '12px', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                      <img
                        src="/assets/icon-swords.png"
                        alt=""
                        style={{ width: '15px', height: '15px', objectFit: 'contain' }}
                      />
                      <span>Challenge</span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 2-Column Wide Layout: Quiz Source (Left) + Difficulty & Launch (Right) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '28px', alignItems: 'stretch' }}>
        {/* Source Selection: Topic vs PDF */}
        <div className="glass-panel" style={{ padding: '32px', background: '#FFFFFF', border: '1.5px solid #E2E8F0', display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ fontSize: '19px', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '18px' }}>
            Choose Quiz Source
          </h3>

          <div style={{ display: 'flex', gap: '12px', marginBottom: '22px' }}>
            <button
              onClick={() => setSourceType('topic')}
              className={sourceType === 'topic' ? 'btn btn-primary' : 'btn btn-secondary'}
              style={{ flex: 1, padding: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
            >
              <img
                src="/assets/icon-ai-star.png"
                alt=""
                style={{ width: '18px', height: '18px', objectFit: 'contain' }}
              />
              <span>Enter Any Topic</span>
            </button>
            <button
              onClick={() => setSourceType('pdf')}
              className={sourceType === 'pdf' ? 'btn btn-primary' : 'btn btn-secondary'}
              style={{ flex: 1, padding: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
            >
              <Upload size={16} />
              <span>Upload Study PDF</span>
            </button>
          </div>

          {sourceType === 'topic' ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <label style={{ display: 'block', fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>
                What do you want to battle on?
              </label>
              <input
                type="text"
                placeholder="e.g. World History, Machine Learning, World Cup, Space..."
                className="input-field"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                style={{ marginBottom: '18px', fontSize: '15px' }}
              />

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
                <Compass size={14} color="var(--text-muted)" />
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.04em' }}>POPULAR TOPICS:</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {POPULAR_TOPICS.map((item) => (
                  <button
                    key={item}
                    onClick={() => setTopic(item)}
                    style={{
                      background: topic === item ? '#F5F3FF' : '#F8FAFC',
                      border: topic === item ? '1.5px solid #7C3AED' : '1px solid #E2E8F0',
                      color: topic === item ? '#7C3AED' : 'var(--text-secondary)',
                      borderRadius: '20px',
                      padding: '7px 14px',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <label style={{ display: 'block', fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>
                Upload Study Document / Notes (PDF only)
              </label>
              <div
                style={{
                  flex: 1,
                  border: '2px dashed #C4B5FD',
                  borderRadius: '16px',
                  padding: '36px 20px',
                  textAlign: 'center',
                  backgroundColor: '#FAF5FF',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.15s ease',
                }}
                onClick={() => document.getElementById('pdf-file-input')?.click()}
              >
                <input
                  id="pdf-file-input"
                  type="file"
                  accept="application/pdf"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      setPdfFile(e.target.files[0]);
                    }
                  }}
                />
                <FileText size={44} color="#7C3AED" style={{ margin: '0 auto 12px auto' }} />
                <h4 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '6px' }}>
                  {pdfFile ? pdfFile.name : 'Click to select or drag and drop a PDF file'}
                </h4>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                  {pdfFile ? `${(pdfFile.size / 1024 / 1024).toFixed(2)} MB • Ready to analyze` : 'Max 25MB • Up to 50 pages'}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Difficulty & Question Count + Launch Button */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div className="glass-panel" style={{ padding: '32px', background: '#FFFFFF', border: '1.5px solid #E2E8F0', flex: 1 }}>
            <h3 style={{ fontSize: '19px', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '22px' }}>
              Match Settings
            </h3>

            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '10px' }}>
                Difficulty Level
              </label>
              <div style={{ display: 'flex', gap: '10px' }}>
                {(['easy', 'medium', 'hard'] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => setDifficulty(d)}
                    style={{
                      flex: 1,
                      padding: '12px 10px',
                      borderRadius: '12px',
                      border: difficulty === d ? '2px solid #7C3AED' : '1px solid #E2E8F0',
                      background: difficulty === d ? '#F5F3FF' : '#F8FAFC',
                      color: difficulty === d ? '#7C3AED' : 'var(--text-secondary)',
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      fontSize: '13px',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      boxShadow: difficulty === d ? '0 4px 12px rgba(124, 58, 237, 0.12)' : 'none',
                    }}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '10px' }}>
                Question Count
              </label>
              <div style={{ display: 'flex', gap: '10px' }}>
                {[5, 10, 15].map((cnt) => (
                  <button
                    key={cnt}
                    onClick={() => setQuestionCount(cnt)}
                    style={{
                      flex: 1,
                      padding: '12px 10px',
                      borderRadius: '12px',
                      border: questionCount === cnt ? '2px solid #F97316' : '1px solid #E2E8F0',
                      background: questionCount === cnt ? '#FFF7ED' : '#F8FAFC',
                      color: questionCount === cnt ? '#C2410C' : 'var(--text-secondary)',
                      fontWeight: 800,
                      fontSize: '14px',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      boxShadow: questionCount === cnt ? '0 4px 12px rgba(249, 115, 22, 0.12)' : 'none',
                    }}
                  >
                    {cnt} Questions
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Launch Action Button */}
          <div>
            {gameMode === 'solo' ? (
              <button
                onClick={handleStartSolo}
                className="btn btn-primary btn-shimmer"
                style={{ width: '100%', padding: '18px 28px', fontSize: '17px', borderRadius: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', boxShadow: '0 8px 24px rgba(124, 58, 237, 0.25)' }}
              >
                <img
                  src="/assets/icon-ai-star.png"
                  alt=""
                  style={{ width: '22px', height: '22px', objectFit: 'contain' }}
                />
                <span>Launch Solo Practice</span>
              </button>
            ) : (
              <button
                onClick={() => handleStartChallenge()}
                className="btn btn-orange btn-shimmer"
                style={{ width: '100%', padding: '18px 28px', fontSize: '17px', borderRadius: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', boxShadow: '0 8px 24px rgba(249, 115, 22, 0.25)' }}
              >
                <img
                  src="/assets/icon-swords.png"
                  alt=""
                  style={{ width: '22px', height: '22px', objectFit: 'contain' }}
                />
                <span>{selectedOpponent ? `Challenge ${selectedOpponent.displayName}` : 'Select an Online Opponent Above'}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Waiting Modal */}
      {waitingModalVisible && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.45)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
        >
          <div
            className="glass-panel"
            style={{
              maxWidth: '420px',
              width: '100%',
              padding: '36px 32px',
              textAlign: 'center',
              background: '#FFFFFF',
              border: '1px solid #EDE9FE',
              boxShadow: '0 20px 40px -10px rgba(124, 58, 237, 0.15)',
              borderRadius: '24px',
            }}
          >
            <div style={{ marginBottom: '20px', position: 'relative', display: 'inline-block' }}>
              <div
                style={{
                  width: '72px',
                  height: '72px',
                  borderRadius: '20px',
                  background: 'linear-gradient(135deg, #FFF7ED 0%, #F5F3FF 100%)',
                  border: '1px solid #FED7AA',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto',
                }}
                className="pulse-glow"
              >
                <img
                  src={gameMode === 'solo' ? '/assets/icon-ai-star.png' : '/assets/icon-swords.png'}
                  alt="Mode"
                  style={{ width: '48px', height: '48px', objectFit: 'contain' }}
                />
              </div>
            </div>

            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
              <span className="badge badge-purple" style={{ fontSize: '10px', padding: '3px 8px' }}>
                QUIZZYFOX AI TRIVIA
              </span>
            </div>

            <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '8px' }}>
              {gameMode === 'solo' ? 'Synthesizing AI Questions...' : 'Establishing 1v1 Battle Link'}
            </h3>

            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '28px', lineHeight: 1.5 }}>
              {challengeStatusMessage}
            </p>

            <button onClick={handleCancelChallenge} className="btn btn-secondary" style={{ width: '100%' }}>
              Cancel Request
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
