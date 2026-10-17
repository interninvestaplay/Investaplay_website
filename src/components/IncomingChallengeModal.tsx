import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Swords, Sparkles, X, Check, Clock, Trophy } from 'lucide-react';
import { getSocket } from '../services/socket';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { IncomingChallengeData } from '../types';

export const IncomingChallengeModal: React.FC = () => {
  const [challenge, setChallenge] = useState<IncomingChallengeData | null>(null);
  const [visible, setVisible] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [timeLeft, setTimeLeft] = useState(30);
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) return;
    const socket = getSocket();
    if (!socket) return;

    const handleChallengeReceived = (payload: any) => {
      console.log('[QuizWeb] Incoming challenge:', payload);
      const ch = payload?.challenge || payload?.data || payload;
      const rawData = payload?.data || {};

      const challengeId = ch?.id || ch?.challengeId || rawData?.challengeId;
      if (!challengeId) return;

      const challengerName =
        ch?.challenger_name ||
        ch?.challenger?.display_name ||
        ch?.challengerName ||
        payload?.title?.split(' ')[0] ||
        'A Player';

      const challengerId = ch?.challenger_id || ch?.challenger?.id || rawData?.challengerId || '';
      const quizType = ch?.quiz_type || rawData?.quizType || 'standard';
      const topic = ch?.topic || rawData?.topic || (quizType === 'quick_quiz' ? 'AI Quiz' : 'General');
      const difficulty = ch?.difficulty || rawData?.difficulty || 'medium';
      const questionCount = Number(ch?.question_limit || rawData?.questionCount || 5);

      setChallenge({
        challengeId,
        challengerId,
        challengerName,
        challengerAvatar: ch?.challenger_avatar,
        quizType,
        topic,
        difficulty,
        questionCount,
        endsAt: ch?.ends_at,
      });

      setTimeLeft(30);
      setVisible(true);

      // Web Audio chime
      try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
        osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.15); // A5
        gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.4);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.4);
      } catch (_) {}
    };

    const handleChallengeCancelled = (payload: any) => {
      const chId = payload?.challengeId || payload?.data?.challengeId;
      if (!challenge || challenge.challengeId === chId) {
        setVisible(false);
        setChallenge(null);
      }
    };

    socket.on('challenge:received', handleChallengeReceived);
    socket.on('challenge:cancelled', handleChallengeCancelled);

    return () => {
      socket.off('challenge:received', handleChallengeReceived);
      socket.off('challenge:cancelled', handleChallengeCancelled);
    };
  }, [user, challenge]);

  useEffect(() => {
    if (!visible) return;
    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          setVisible(false);
          setChallenge(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [visible]);

  const handleAccept = async () => {
    if (!challenge || accepting) return;
    setAccepting(true);
    try {
      const res = await api.acceptChallenge(challenge.challengeId);
      const roomId = res.roomId || res.challenge?.room_id;
      setVisible(false);
      setChallenge(null);
      setAccepting(false);
      if (roomId) {
        navigate(`/room/${roomId}`);
      }
    } catch (err: any) {
      alert(err.message || 'Could not accept challenge');
      setVisible(false);
      setChallenge(null);
      setAccepting(false);
    }
  };

  const handleDecline = async () => {
    if (!challenge) return;
    try {
      await api.declineChallenge(challenge.challengeId);
    } catch (_) {}
    setVisible(false);
    setChallenge(null);
  };

  if (!visible || !challenge) return null;

  const isQuickQuiz = challenge.quizType === 'quick_quiz';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.45)',
        backdropFilter: 'blur(8px)',
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
          maxWidth: '440px',
          width: '100%',
          padding: '28px',
          background: '#FFFFFF',
          border: '2px solid var(--primary)',
          boxShadow: '0 20px 50px rgba(124, 58, 237, 0.18), 0 4px 16px rgba(0, 0, 0, 0.06)',
          textAlign: 'center',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
          <span className={isQuickQuiz ? 'badge badge-orange' : 'badge badge-purple'} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <img
              src={isQuickQuiz ? '/assets/icon-ai-star.png' : '/assets/icon-swords.png'}
              alt=""
              style={{ width: '16px', height: '16px', objectFit: 'contain' }}
            />
            <span>{isQuickQuiz ? 'QuizzyFox AI 1v1 Battle' : 'QuizzyFox 1v1 Challenge'}</span>
          </span>
          <button
            onClick={handleDecline}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '4px',
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Challenger Avatar & Name */}
        <div style={{ margin: '16px 0' }}>
          <img
            src={challenge.challengerAvatar || '/assets/avatar-boy.png'}
            alt="Challenger Avatar"
            style={{
              width: '84px',
              height: '84px',
              borderRadius: '50%',
              margin: '0 auto 12px auto',
              objectFit: 'cover',
              border: '3px solid var(--secondary)',
              boxShadow: '0 4px 16px rgba(249, 115, 22, 0.3)',
              display: 'block',
            }}
          />
          <h2
            style={{
              fontFamily: 'var(--font-heading)',
              fontSize: '22px',
              fontWeight: 800,
              color: 'var(--text-primary)',
              marginBottom: '4px',
              letterSpacing: '-0.01em',
            }}
          >
            {challenge.challengerName}
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
            challenged you to a live 1v1 duel!
          </p>
        </div>

        {/* Match Info Box */}
        <div
          style={{
            background: '#F8FAFC',
            border: '1px solid var(--border-light)',
            borderRadius: '16px',
            padding: '16px',
            marginBottom: '20px',
            textAlign: 'left',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Topic:</span>
            <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '14px' }}>
              {challenge.topic || 'General Knowledge'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                background: '#FEF3C7',
                padding: '4px 10px',
                borderRadius: '8px',
                fontSize: '12px',
                color: '#D97706',
                fontWeight: 600,
              }}
            >
              <Trophy size={13} color="#D97706" />
              {(challenge.difficulty || 'Medium').toUpperCase()}
            </span>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                background: '#EDE9FE',
                padding: '4px 10px',
                borderRadius: '8px',
                fontSize: '12px',
                color: 'var(--primary)',
                fontWeight: 600,
              }}
            >
              <Clock size={13} color="var(--primary)" />
              {challenge.questionCount || 5} Questions • 15s/Q
            </span>
          </div>
        </div>

        {/* Countdown Bar */}
        <div style={{ marginBottom: '20px' }}>
          <div
            style={{
              width: '100%',
              height: '6px',
              background: '#E2E8F0',
              borderRadius: '3px',
              overflow: 'hidden',
              marginBottom: '6px',
            }}
          >
            <div
              style={{
                width: `${(timeLeft / 30) * 100}%`,
                height: '100%',
                background: isQuickQuiz ? 'var(--orange-gradient)' : 'var(--purple-gradient)',
                transition: 'width 1s linear',
              }}
            />
          </div>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Auto-declines in {timeLeft}s
          </span>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={handleDecline}
            className="btn btn-secondary"
            style={{ flex: 1, padding: '12px' }}
          >
            Decline
          </button>
          <button
            onClick={handleAccept}
            className={isQuickQuiz ? 'btn btn-orange' : 'btn btn-primary'}
            style={{ flex: 2, padding: '12px' }}
            disabled={accepting}
          >
            {accepting ? (
              'Joining Room...'
            ) : (
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <img
                  src="/assets/icon-swords.png"
                  alt=""
                  style={{ width: '18px', height: '18px', objectFit: 'contain' }}
                />
                <span>Accept & Battle</span>
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
