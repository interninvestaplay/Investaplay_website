import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import confetti from 'canvas-confetti';
import { Clock, Zap, Trophy, Flame, Check, X, ArrowRight, RotateCcw, FastForward } from 'lucide-react';
import { getSocket } from '../services/socket';
import { useAuth } from '../context/AuthContext';
import { Question } from '../types';

export const GamePage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, updateCoins } = useAuth();

  const state = location.state as {
    questions?: any[];
    topic?: string;
    difficulty?: string;
    isSolo?: boolean;
    isMultiplayer?: boolean;
    gameId?: string;
    roomId?: string;
    sessionId?: string;
  } | null;

  // Solo mode local state
  const isSolo = !!state?.isSolo;
  const rawQuestions = state?.questions || [];

  const [currentIdx, setCurrentIdx] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [isAnswerSubmitted, setIsAnswerSubmitted] = useState(false);
  const [score, setScore] = useState(0);
  const [opponentScore, setOpponentScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [timeLeft, setTimeLeft] = useState(15);
  const [gameOver, setGameOver] = useState(false);
  const [answersLog, setAnswersLog] = useState<{ isCorrect: boolean; points: number }[]>([]);

  // Lifelines (4 Powerups)
  const [fiftyFiftyUsed, setFiftyFiftyUsed] = useState(false);
  const [hiddenOptions, setHiddenOptions] = useState<string[]>([]);
  const [skipUsed, setSkipUsed] = useState(false);
  const [extraTimeUsed, setExtraTimeUsed] = useState(false);
  const [timeBonusActive, setTimeBonusActive] = useState(false);
  const [doubleScoreUsed, setDoubleScoreUsed] = useState(false);
  const [isDoubleScoreActive, setIsDoubleScoreActive] = useState(false);

  // Timer Ref
  const timerRef = useRef<any>(null);

  useEffect(() => {
    if (!user) {
      navigate('/login', {
        state: { from: { pathname: '/game' }, message: 'Please Sign In or Register to play the game!' },
      });
    }
  }, [user, navigate]);

  const currentQ = rawQuestions[currentIdx] || null;

  // Options normalization
  const getOptionsList = (q: any): { key: string; text: string }[] => {
    if (!q) return [];
    if (Array.isArray(q.options)) {
      return q.options.map((opt: any, i: number) => {
        const key = ['A', 'B', 'C', 'D'][i];
        if (typeof opt === 'object') {
          return { key, text: opt.text || opt.option || String(opt) };
        }
        return { key, text: String(opt) };
      });
    }
    if (typeof q.options === 'object') {
      return Object.entries(q.options).map(([k, v]) => ({
        key: k.toUpperCase(),
        text: String(v),
      }));
    }
    if (q.option_a !== undefined) {
      return [
        { key: 'A', text: String(q.option_a) },
        { key: 'B', text: String(q.option_b) },
        { key: 'C', text: String(q.option_c) },
        { key: 'D', text: String(q.option_d) },
      ];
    }
    return [];
  };

  // Robust correct answer resolver supporting correctOption, correct_option, correctAnswer, etc.
  const getCorrectKeyAndText = (q: any): { correctKey: string; correctText: string } => {
    if (!q) return { correctKey: '', correctText: '' };

    const rawCorrect =
      q.correctOption !== undefined
        ? q.correctOption
        : q.correct_option !== undefined
        ? q.correct_option
        : q.correctAnswer !== undefined
        ? q.correctAnswer
        : q.correct_answer !== undefined
        ? q.correct_answer
        : q.answer !== undefined
        ? q.answer
        : q.correct;

    const opts = getOptionsList(q);
    const letters = ['A', 'B', 'C', 'D'];

    // 1. Integer index (0, 1, 2, 3)
    if (typeof rawCorrect === 'number' && rawCorrect >= 0 && rawCorrect < 4) {
      const key = letters[rawCorrect];
      const text = opts[rawCorrect]?.text || '';
      return { correctKey: key, correctText: text };
    }

    const str = String(rawCorrect ?? '').trim();

    // 2. String numeric index ("0", "1", "2", "3")
    if (/^[0-3]$/.test(str)) {
      const idx = parseInt(str, 10);
      const key = letters[idx];
      const text = opts[idx]?.text || '';
      return { correctKey: key, correctText: text };
    }

    // 3. String letter ("A", "B", "C", "D")
    const upper = str.toUpperCase();
    if (['A', 'B', 'C', 'D'].includes(upper)) {
      const idx = letters.indexOf(upper);
      const text = opts[idx]?.text || '';
      return { correctKey: upper, correctText: text };
    }

    // 4. Matches option text directly (e.g. "Paris")
    const matched = opts.find((o) => o.text.trim().toLowerCase() === str.toLowerCase());
    if (matched) {
      return { correctKey: matched.key, correctText: matched.text };
    }

    return { correctKey: upper, correctText: str };
  };

  const optionsList = getOptionsList(currentQ);

  // Sound generator using Web Audio API
  const playTone = (type: 'correct' | 'wrong' | 'click' | 'victory') => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'correct') {
        osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
        osc.frequency.exponentialRampToValueAtTime(659.25, ctx.currentTime + 0.1); // E5
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
      } else if (type === 'wrong') {
        osc.frequency.setValueAtTime(300, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(150, ctx.currentTime + 0.2);
        gain.gain.setValueAtTime(0.25, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
      } else if (type === 'victory') {
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.4);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6);
        osc.start();
        osc.stop(ctx.currentTime + 0.6);
      }
    } catch (_) {}
  };

  // 15-second per-question timer
  useEffect(() => {
    if (gameOver || isAnswerSubmitted || !currentQ) return;

    setTimeLeft(15);
    if (timerRef.current) clearInterval(timerRef.current);

    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          handleTimeOut();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [currentIdx, gameOver, isAnswerSubmitted]);

  // Handle timeout
  const handleTimeOut = () => {
    setIsAnswerSubmitted(true);
    playTone('wrong');
    setStreak(0);
    setAnswersLog((prev) => [...prev, { isCorrect: false, points: 0 }]);

    setTimeout(() => {
      advanceNextQuestion();
    }, 1800);
  };

  // Submit Answer
  const handleSelectOption = (key: string, optionText: string) => {
    if (isAnswerSubmitted || gameOver) return;

    setSelectedAnswer(key);
    setIsAnswerSubmitted(true);
    if (timerRef.current) clearInterval(timerRef.current);

    // Check correctness using normalized key and text
    const { correctKey, correctText } = getCorrectKeyAndText(currentQ);
    const isCorrect =
      key.toUpperCase() === correctKey ||
      (!!correctText && optionText.trim().toLowerCase() === correctText.trim().toLowerCase());

    if (isCorrect) {
      playTone('correct');
      const timeBonus = Math.max(5, timeLeft * 4);
      const basePoints = 50 + timeBonus;
      const points = isDoubleScoreActive ? basePoints * 2 : basePoints;
      setScore((s) => s + points);
      setStreak((st) => st + 1);
      setAnswersLog((prev) => [...prev, { isCorrect: true, points }]);
    } else {
      playTone('wrong');
      setStreak(0);
      setAnswersLog((prev) => [...prev, { isCorrect: false, points: 0 }]);
    }

    setTimeout(() => {
      advanceNextQuestion();
    }, 1800);
  };

  // Next Question or End Game
  const advanceNextQuestion = () => {
    setSelectedAnswer(null);
    setIsAnswerSubmitted(false);
    setHiddenOptions([]);
    setIsDoubleScoreActive(false);

    if (currentIdx + 1 < rawQuestions.length) {
      setCurrentIdx((i) => i + 1);
    } else {
      finishGame();
    }
  };

  // Finish Game
  const finishGame = () => {
    setGameOver(true);
    playTone('victory');
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
    });

    if (user) {
      const earnedCoins = Math.floor(score / 10) + 20;
      updateCoins((user.coins || 100) + earnedCoins);
    }
  };

  // Lifelines (4 Powerups)
  const handleFiftyFifty = () => {
    if (fiftyFiftyUsed || isAnswerSubmitted || optionsList.length < 4) return;
    setFiftyFiftyUsed(true);

    const { correctKey } = getCorrectKeyAndText(currentQ);
    const wrongOptions = optionsList.filter((o) => o.key !== correctKey);
    const toRemove = wrongOptions.slice(0, 2).map((o) => o.key);
    setHiddenOptions(toRemove);
  };

  const handleSkip = () => {
    if (skipUsed || isAnswerSubmitted) return;
    setSkipUsed(true);
    advanceNextQuestion();
  };

  const handleExtraTime = () => {
    if (extraTimeUsed || isAnswerSubmitted || gameOver) return;
    setExtraTimeUsed(true);
    setTimeLeft((prev) => prev + 15);
    setTimeBonusActive(true);
    playTone('correct');
    setTimeout(() => setTimeBonusActive(false), 2500);
  };

  const handleDoubleScore = () => {
    if (doubleScoreUsed || isAnswerSubmitted || gameOver || isDoubleScoreActive) return;
    setDoubleScoreUsed(true);
    setIsDoubleScoreActive(true);
    playTone('correct');
  };

  if (!rawQuestions.length && !gameOver) {
    return (
      <div style={{ textAlign: 'center', padding: '100px 0', color: 'var(--text-muted)' }}>
        <p style={{ fontSize: '18px', marginBottom: '16px' }}>No active quiz session found.</p>
        <button onClick={() => navigate('/quick-quiz')} className="btn btn-primary">
          Back to Quick Quiz AI
        </button>
      </div>
    );
  }

  // GAME OVER RESULTS SCREEN
  if (gameOver) {
    const totalCorrect = answersLog.filter((a) => a.isCorrect).length;
    const accuracy = Math.round((totalCorrect / rawQuestions.length) * 100) || 0;
    const coinsEarned = Math.floor(score / 10) + 20;

    return (
      <div style={{ maxWidth: '560px', margin: '20px auto', textAlign: 'center' }}>
        <div
          className="glass-panel"
          style={{
            padding: '44px 36px',
            background: 'rgba(255, 255, 255, 0.94)',
            backdropFilter: 'blur(24px) saturate(180%)',
            border: '1.5px solid rgba(255, 255, 255, 0.95)',
            boxShadow: '0 20px 50px -10px rgba(124, 58, 237, 0.16), 0 4px 12px rgba(15, 23, 42, 0.05)',
            borderRadius: '24px',
          }}
        >
          <div style={{ marginBottom: '20px' }} className="float-effect">
            <img
              src="/assets/trophy.png"
              alt="Victory Trophy"
              style={{
                width: '100px',
                height: '100px',
                objectFit: 'contain',
                margin: '0 auto',
                filter: 'drop-shadow(0 4px 16px rgba(245, 158, 11, 0.35))',
              }}
            />
          </div>

          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <span className="badge badge-purple" style={{ fontSize: '11px', padding: '3px 10px' }}>
              MATCH SUMMARY
            </span>
            <span className="badge badge-purple" style={{ fontSize: '11px', padding: '3px 10px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
              <img src="/assets/investaplay-logo.png" alt="InvestaPlay Studio" style={{ width: '12px', height: '12px', objectFit: 'contain' }} />
              <span>POWERED BY INVESTAPLAY STUDIO</span>
            </span>
          </div>

          <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: '30px', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '6px', letterSpacing: '-0.02em' }}>
            {accuracy >= 60 ? 'Victory! Well Played!' : 'Match Concluded'}
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '32px' }}>
            {state?.topic || 'Quiz Session Completed'}
          </p>

          {/* Stats Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px', marginBottom: '32px' }}>
            <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '16px', padding: '16px 12px' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>TOTAL SCORE</span>
              <h3 style={{ fontSize: '24px', fontWeight: 800, color: '#7C3AED', fontFamily: 'var(--font-mono)', marginTop: '4px' }}>{score}</h3>
            </div>
            <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '16px', padding: '16px 12px' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>ACCURACY</span>
              <h3 style={{ fontSize: '24px', fontWeight: 800, color: '#059669', fontFamily: 'var(--font-mono)', marginTop: '4px' }}>{accuracy}%</h3>
            </div>
            <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '16px', padding: '16px 12px' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>REWARD</span>
              <h3 style={{ fontSize: '24px', fontWeight: 800, color: '#B45309', fontFamily: 'var(--font-mono)', marginTop: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                <img src="/assets/coins.png" alt="" style={{ width: '22px', height: '22px', objectFit: 'contain' }} />
                <span>+{coinsEarned}</span>
              </h3>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '14px' }}>
            <button onClick={() => navigate('/quick-quiz')} className="btn btn-secondary" style={{ flex: 1, padding: '13px' }}>
              <RotateCcw size={16} />
              <span>Rematch / New</span>
            </button>
            <button onClick={() => navigate('/')} className="btn btn-primary" style={{ flex: 1, padding: '13px' }}>
              <span>Return Home</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // IN-GAME SCREEN
  const progressPercent = ((currentIdx + 1) / rawQuestions.length) * 100;
  const timerRatio = timeLeft / 15;

  return (
    <div style={{ width: '100%', maxWidth: '1280px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Top Game Bar: Question Count, Timer, Score */}
      <div
        className="glass-panel"
        style={{
          padding: '16px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderRadius: '16px',
          background: '#FFFFFF',
          border: '1px solid #E2E8F0',
        }}
      >
        {/* Progress Pill */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>
            QUESTION {String(currentIdx + 1).padStart(2, '0')} / {String(rawQuestions.length).padStart(2, '0')}
          </span>
          {streak >= 2 && (
            <span className="badge badge-orange" style={{ fontFamily: 'var(--font-mono)' }}>
              <Flame size={12} color="#EA580C" /> {streak}x STREAK
            </span>
          )}
        </div>

        {/* 15s Countdown Timer */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            backgroundColor: timeLeft <= 5 ? '#FEF2F2' : '#F5F3FF',
            border: `1.5px solid ${timeLeft <= 5 ? '#EF4444' : '#7C3AED'}`,
            padding: '5px 14px',
            borderRadius: '999px',
            fontWeight: 800,
            fontSize: '14px',
            fontFamily: 'var(--font-mono)',
            color: timeLeft <= 5 ? '#DC2626' : '#7C3AED',
            animation: timeLeft <= 5 ? 'pulseGlow 1s infinite' : 'none',
          }}
        >
          <Clock size={15} />
          <span>{String(timeLeft).padStart(2, '0')}s</span>
        </div>

        {/* Score Pill */}
        <div
          style={{
            fontSize: '13px',
            fontWeight: 800,
            color: '#B45309',
            fontFamily: 'var(--font-mono)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: '#FEF3C7',
            border: '1px solid #FDE68A',
            padding: '4px 12px',
            borderRadius: '999px',
          }}
        >
          <span>{score} PTS</span>
        </div>
      </div>

      {/* Progress Bar */}
      <div style={{ width: '100%', height: '5px', background: '#E2E8F0', borderRadius: '999px', overflow: 'hidden' }}>
        <div
          style={{
            width: `${progressPercent}%`,
            height: '100%',
            background: 'var(--purple-gradient)',
            transition: 'width 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        />
      </div>

      {/* Question Card */}
      <div
        className="glass-panel"
        style={{
          padding: '36px 32px',
          textAlign: 'center',
          background: 'rgba(255, 255, 255, 0.92)',
          backdropFilter: 'blur(24px) saturate(180%)',
          border: '1.5px solid rgba(255, 255, 255, 0.95)',
          boxShadow: '0 12px 32px -4px rgba(124, 58, 237, 0.12), 0 2px 8px rgba(15, 23, 42, 0.04)',
          borderRadius: '20px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
          <span className="badge badge-purple">
            {state?.topic || currentQ?.category || 'General Knowledge'}
          </span>
          {isDoubleScoreActive && (
            <span className="badge badge-orange pulse-glow" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
              <Zap size={13} fill="#F97316" /> 2X Score Active!
            </span>
          )}
          {timeBonusActive && (
            <span className="badge badge-green pulse-glow" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
              <Clock size={13} /> +15s Added!
            </span>
          )}
        </div>

        <h2
          style={{
            fontFamily: 'var(--font-heading)',
            fontSize: '22px',
            fontWeight: 700,
            color: 'var(--text-primary)',
            lineHeight: 1.45,
            letterSpacing: '-0.01em',
          }}
        >
          {currentQ.text || currentQ.question}
        </h2>
      </div>

      {/* Options 2x2 Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
        {optionsList.map(({ key, text }) => {
          const isHidden = hiddenOptions.includes(key);
          if (isHidden) {
            return (
              <div
                key={key}
                style={{
                  height: '72px',
                  borderRadius: '16px',
                  border: '1px dashed #E2E8F0',
                  opacity: 0.3,
                }}
              />
            );
          }

          const isSelected = selectedAnswer === key;
          const { correctKey, correctText } = getCorrectKeyAndText(currentQ);
          const isThisCorrect =
            key.toUpperCase() === correctKey ||
            (!!correctText && text.trim().toLowerCase() === correctText.trim().toLowerCase());

          let btnBackground = '#FFFFFF';
          let btnBorder = '1.5px solid #E2E8F0';
          let badgeBg = '#F1F5F9';
          let badgeColor = '#475569';
          let textColor = 'var(--text-primary)';

          if (isAnswerSubmitted) {
            if (isThisCorrect) {
              btnBackground = '#ECFDF5';
              btnBorder = '2px solid #10B981';
              badgeBg = '#10B981';
              badgeColor = '#FFFFFF';
              textColor = '#065F46';
            } else if (isSelected) {
              btnBackground = '#FEF2F2';
              btnBorder = '2px solid #EF4444';
              badgeBg = '#EF4444';
              badgeColor = '#FFFFFF';
              textColor = '#991B1B';
            }
          } else if (isSelected) {
            btnBackground = '#F5F3FF';
            btnBorder = '2px solid #7C3AED';
            badgeBg = '#7C3AED';
            badgeColor = '#FFFFFF';
            textColor = '#5B21B6';
          }

          return (
            <button
              key={key}
              onClick={() => handleSelectOption(key, text)}
              disabled={isAnswerSubmitted}
              className="glass-panel"
              style={{
                padding: '18px 20px',
                borderRadius: '16px',
                background: btnBackground,
                border: btnBorder,
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
                textAlign: 'left',
                cursor: isAnswerSubmitted ? 'default' : 'pointer',
                transition: 'all 0.15s ease',
                boxShadow: isSelected ? '0 4px 12px rgba(124, 58, 237, 0.12)' : '0 1px 3px rgba(15, 23, 42, 0.04)',
              }}
            >
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '9px',
                  background: badgeBg,
                  color: badgeColor,
                  fontWeight: 800,
                  fontSize: '14px',
                  fontFamily: 'var(--font-mono)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  transition: 'all 0.15s ease',
                }}
              >
                {key}
              </div>
              <span style={{ fontSize: '14px', fontWeight: 600, color: textColor, flex: 1, lineHeight: 1.35 }}>
                {text}
              </span>
              {isAnswerSubmitted && isThisCorrect && (
                <Check size={18} color="#10B981" style={{ flexShrink: 0 }} />
              )}
              {isAnswerSubmitted && isSelected && !isThisCorrect && (
                <X size={18} color="#EF4444" style={{ flexShrink: 0 }} />
              )}
            </button>
          );
        })}
      </div>

      {/* Educational Explanation Box */}
      {isAnswerSubmitted && currentQ?.explanation && (
        <div
          className="glass-panel"
          style={{
            padding: '16px 20px',
            backgroundColor: '#F8FAFC',
            border: '1.5px solid #E2E8F0',
            borderRadius: '16px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px',
            textAlign: 'left',
          }}
        >
          <div
            style={{
              padding: '6px',
              borderRadius: '8px',
              background: '#EFF6FF',
              color: '#2563EB',
              flexShrink: 0,
            }}
          >
            <Zap size={16} />
          </div>
          <div style={{ fontSize: '13px', lineHeight: 1.5, color: 'var(--text-secondary)' }}>
            <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: '2px' }}>
              Explanation:
            </strong>
            {currentQ.explanation}
          </div>
        </div>
      )}

      {/* Lifelines Bar (4 Powerups) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginTop: '6px' }}>
        <button
          onClick={handleFiftyFifty}
          disabled={fiftyFiftyUsed || isAnswerSubmitted}
          className="btn btn-secondary"
          style={{
            fontSize: '13px',
            padding: '10px 8px',
            opacity: fiftyFiftyUsed ? 0.35 : 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            borderRadius: '12px',
          }}
          title="50:50 - Remove two wrong options"
        >
          <span style={{ fontWeight: 800 }}>✂️ 50:50</span>
        </button>

        <button
          onClick={handleSkip}
          disabled={skipUsed || isAnswerSubmitted}
          className="btn btn-secondary"
          style={{
            fontSize: '13px',
            padding: '10px 8px',
            opacity: skipUsed ? 0.35 : 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            borderRadius: '12px',
          }}
          title="Skip - Move to next question"
        >
          <FastForward size={14} />
          <span>Skip</span>
        </button>

        <button
          onClick={handleExtraTime}
          disabled={extraTimeUsed || isAnswerSubmitted}
          className="btn btn-secondary"
          style={{
            fontSize: '13px',
            padding: '10px 8px',
            opacity: extraTimeUsed ? 0.35 : 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            borderRadius: '12px',
          }}
          title="+15s - Add 15 extra seconds"
        >
          <Clock size={14} color="#10B981" />
          <span>+15s Time</span>
        </button>

        <button
          onClick={handleDoubleScore}
          disabled={doubleScoreUsed || isAnswerSubmitted || isDoubleScoreActive}
          className={isDoubleScoreActive ? "btn btn-orange pulse-glow" : "btn btn-secondary"}
          style={{
            fontSize: '13px',
            padding: '10px 8px',
            opacity: doubleScoreUsed && !isDoubleScoreActive ? 0.35 : 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            borderRadius: '12px',
          }}
          title="2X - Double points on this question"
        >
          <Zap size={14} color={isDoubleScoreActive ? "#FFFFFF" : "#F97316"} fill={isDoubleScoreActive ? "#FFFFFF" : "#F97316"} />
          <span>2X Score</span>
        </button>
      </div>
    </div>
  );
};
