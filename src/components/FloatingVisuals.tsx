import React from 'react';

export const FloatingVisuals: React.FC = () => {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 0,
        overflow: 'hidden',
      }}
    >
      {/* 3D Glossy Sphere - Top Right (Pink) */}
      <div
        className="visual-orb visual-orb-pink float-effect-slow"
        style={{
          width: '72px',
          height: '72px',
          top: '12%',
          right: '6%',
          opacity: 0.85,
        }}
      />

      {/* 3D Glossy Sphere - Top Left (Cyan) */}
      <div
        className="visual-orb visual-orb-cyan float-effect"
        style={{
          width: '54px',
          height: '54px',
          top: '18%',
          left: '4%',
          opacity: 0.8,
        }}
      />

      {/* 3D Glossy Sphere - Mid Right (Purple) */}
      <div
        className="visual-orb visual-orb-purple float-effect"
        style={{
          width: '88px',
          height: '88px',
          top: '55%',
          right: '3%',
          opacity: 0.75,
        }}
      />

      {/* 3D Glossy Sphere - Bottom Left (Amber/Peach) */}
      <div
        className="visual-orb visual-orb-amber float-effect-slow"
        style={{
          width: '64px',
          height: '64px',
          bottom: '15%',
          left: '6%',
          opacity: 0.85,
        }}
      />

      {/* Real Floating 3D Game Icons */}
      {/* 3D Gold Coins floating on mid-left */}
      <div
        className="float-effect"
        style={{
          position: 'absolute',
          top: '32%',
          left: '3%',
          width: '42px',
          height: '42px',
          opacity: 0.8,
          filter: 'drop-shadow(0 6px 16px rgba(245, 158, 11, 0.35))',
        }}
      >
        <img
          src="/assets/coins.png"
          alt="Coins"
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      </div>

      {/* 3D Championship Trophy floating top-center-right */}
      <div
        className="float-effect-slow"
        style={{
          position: 'absolute',
          top: '16%',
          right: '18%',
          width: '38px',
          height: '38px',
          opacity: 0.75,
          filter: 'drop-shadow(0 6px 16px rgba(245, 158, 11, 0.3))',
        }}
      >
        <img
          src="/assets/trophy.png"
          alt="Trophy"
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      </div>

      {/* 3D AI Crystal Star floating mid-right */}
      <div
        className="float-effect"
        style={{
          position: 'absolute',
          top: '46%',
          right: '5%',
          width: '38px',
          height: '38px',
          opacity: 0.85,
          filter: 'drop-shadow(0 6px 14px rgba(249, 115, 22, 0.4))',
        }}
      >
        <img
          src="/assets/icon-ai-star.png"
          alt="AI Star"
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      </div>

      {/* 3D Battle Swords floating bottom-left */}
      <div
        className="float-effect-slow"
        style={{
          position: 'absolute',
          bottom: '22%',
          left: '14%',
          width: '38px',
          height: '38px',
          opacity: 0.8,
          filter: 'drop-shadow(0 6px 14px rgba(124, 58, 237, 0.4))',
        }}
      >
        <img
          src="/assets/icon-swords.png"
          alt="Swords"
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      </div>

      {/* 3D Fire Streak floating bottom-right */}
      <div
        className="float-effect"
        style={{
          position: 'absolute',
          bottom: '18%',
          right: '12%',
          width: '36px',
          height: '36px',
          opacity: 0.85,
          filter: 'drop-shadow(0 6px 14px rgba(239, 68, 68, 0.4))',
        }}
      >
        <img
          src="/assets/icon-fire.png"
          alt="Fire Streak"
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      </div>
    </div>
  );
};
