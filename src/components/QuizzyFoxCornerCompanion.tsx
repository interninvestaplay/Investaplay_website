import React, { useState, useRef } from 'react';
import { Sparkles, Heart } from 'lucide-react';
import { playCuteFoxSound } from '../utils/soundEffects';

const FOX_DIALOGUES = [
  'Yip yip! Let\'s get 100% score! 🦊✨',
  'Hehehe, that tickles! 🐾',
  'Fox power activated! ⚡',
  'You are a true Trivia Champion! 🏆',
  'Aaww yip! Ready for a 1v1 battle? ⚔️',
  'Quizzy believes in you! 🌟',
  'Yip! Let\'s climb the leaderboard! 🚀',
];

interface Particle {
  id: number;
  emoji: string;
  x: number;
  y: number;
}

export const QuizzyFoxCornerCompanion: React.FC = () => {
  const [dialogue, setDialogue] = useState<string | null>(null);
  const [isJumping, setIsJumping] = useState(false);
  const [particles, setParticles] = useState<Particle[]>([]);
  const bubbleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const particleIdRef = useRef(0);

  const handleClickFox = () => {
    // 1. Play cute baby fox yip / chirp sound!
    playCuteFoxSound();

    // 2. Trigger joyful jump & wobble animation
    setIsJumping(true);
    setTimeout(() => setIsJumping(false), 500);

    // 3. Spawn floating particles (hearts, sparkles, paw)
    const emojis = ['💖', '✨', '🐾', '⭐', '🦊', '💫'];
    const newParticles: Particle[] = Array.from({ length: 4 }).map(() => ({
      id: ++particleIdRef.current,
      emoji: emojis[Math.floor(Math.random() * emojis.length)],
      x: (Math.random() - 0.5) * 60,
      y: -(Math.random() * 40 + 20),
    }));
    setParticles((prev) => [...prev, ...newParticles]);

    // Clean particles after animation
    setTimeout(() => {
      setParticles((prev) => prev.filter((p) => !newParticles.includes(p)));
    }, 1000);

    // 4. Show cute random dialogue in speech bubble
    if (bubbleTimeoutRef.current) clearTimeout(bubbleTimeoutRef.current);
    const randomMsg = FOX_DIALOGUES[Math.floor(Math.random() * FOX_DIALOGUES.length)];
    setDialogue(randomMsg);

    bubbleTimeoutRef.current = setTimeout(() => {
      setDialogue(null);
    }, 3200);
  };

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '22px',
        right: '22px',
        zIndex: 9998,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        pointerEvents: 'none',
      }}
    >
      {/* Speech Bubble when tapped */}
      {dialogue && (
        <div
          className="glass-panel"
          style={{
            pointerEvents: 'auto',
            background: 'rgba(255, 255, 255, 0.96)',
            backdropFilter: 'blur(20px) saturate(180%)',
            border: '2px solid #C4B5FD',
            borderRadius: '16px 16px 4px 16px',
            padding: '10px 16px',
            boxShadow: '0 12px 30px rgba(124, 58, 237, 0.18), 0 2px 8px rgba(0, 0, 0, 0.05)',
            maxWidth: '240px',
            marginBottom: '10px',
            animation: 'popupBubble 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
            position: 'relative',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '2px' }}>
            <span style={{ fontSize: '11px', fontWeight: 800, color: '#7C3AED' }}>Quizzy</span>
            <span style={{ fontSize: '10px', color: '#EA580C', fontWeight: 700 }}>Yip! 🐾</span>
          </div>
          <p style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-primary)', margin: 0, lineHeight: 1.35 }}>
            {dialogue}
          </p>
        </div>
      )}

      {/* Floating Particles Burst */}
      <div style={{ position: 'relative', width: 0, height: 0 }}>
        {particles.map((p) => (
          <span
            key={p.id}
            style={{
              position: 'absolute',
              bottom: '40px',
              right: '35px',
              fontSize: '18px',
              userSelect: 'none',
              transform: `translate(${p.x}px, ${p.y}px)`,
              animation: 'floatParticleUp 0.9s ease-out forwards',
            }}
          >
            {p.emoji}
          </span>
        ))}
      </div>

      {/* Mascot Button */}
      <div
        onClick={handleClickFox}
        title="Click Quizzy to hear his cute voice! 🦊🐾"
        style={{
          pointerEvents: 'auto',
          cursor: 'pointer',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          userSelect: 'none',
        }}
      >
        {/* Cute Floating Hint Badge */}
        <span
          className="badge badge-purple pulse-glow"
          style={{
            fontSize: '10px',
            fontWeight: 700,
            padding: '2px 8px',
            marginBottom: '4px',
            background: 'rgba(255, 255, 255, 0.95)',
            border: '1px solid #DDD6FE',
            boxShadow: '0 2px 8px rgba(124, 58, 237, 0.15)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <span>Tap Me!</span>
          <span style={{ fontSize: '11px' }}>🐾</span>
        </span>

        {/* Mascot Avatar with Joyful Jump Effect */}
        <div
          className={isJumping ? '' : 'float-effect'}
          style={{
            position: 'relative',
            width: '68px',
            height: '68px',
            borderRadius: '50%',
            background: 'radial-gradient(circle at 35% 35%, #FFFFFF 0%, #FAF5FF 60%, #EDE9FE 100%)',
            border: '2.5px solid #C4B5FD',
            boxShadow: '0 8px 24px rgba(124, 58, 237, 0.25), inset 0 2px 4px rgba(255, 255, 255, 0.9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'transform 0.15s ease',
            transform: isJumping ? 'scale(1.22) rotate(-8deg)' : 'scale(1)',
            animation: isJumping ? 'foxSquashJump 0.45s cubic-bezier(0.175, 0.885, 0.32, 1.275)' : undefined,
          }}
        >
          <img
            src="/assets/quizzyfox.png"
            alt="QuizzyFox Corner Companion"
            style={{
              width: '60px',
              height: '60px',
              objectFit: 'contain',
              filter: 'drop-shadow(0 4px 10px rgba(124, 58, 237, 0.3))',
            }}
          />

          {/* Sound Wave Indicator Icon */}
          <div
            style={{
              position: 'absolute',
              bottom: '-2px',
              right: '-2px',
              width: '22px',
              height: '22px',
              borderRadius: '50%',
              background: '#F97316',
              border: '2px solid #FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '11px',
              color: '#FFFFFF',
              boxShadow: '0 2px 6px rgba(249, 115, 22, 0.4)',
            }}
          >
            🔊
          </div>
        </div>
      </div>
    </div>
  );
};
