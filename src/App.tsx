import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { Navbar } from './components/Navbar';
import { IncomingChallengeModal } from './components/IncomingChallengeModal';
import { FloatingVisuals } from './components/FloatingVisuals';
import { QuizzyFoxCornerCompanion } from './components/QuizzyFoxCornerCompanion';
import { ProtectedRoute } from './components/ProtectedRoute';
import { HomePage } from './pages/HomePage';
import { QuickQuizPage } from './pages/QuickQuizPage';
import { FriendsPage } from './pages/FriendsPage';
import { QuizRoomPage } from './pages/QuizRoomPage';
import { GamePage } from './pages/GamePage';
import { LeaderboardPage } from './pages/LeaderboardPage';
import { LoginPage } from './pages/LoginPage';

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <BrowserRouter>
        <div className="app-container">
          <FloatingVisuals />
          <QuizzyFoxCornerCompanion />
          <Navbar />
          <IncomingChallengeModal />

          <main className="main-content">
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route
                path="/quick-quiz"
                element={
                  <ProtectedRoute>
                    <QuickQuizPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/friends"
                element={
                  <ProtectedRoute>
                    <FriendsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/room/:roomId"
                element={
                  <ProtectedRoute>
                    <QuizRoomPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/game"
                element={
                  <ProtectedRoute>
                    <GamePage />
                  </ProtectedRoute>
                }
              />
              <Route path="/leaderboard" element={<LeaderboardPage />} />
              <Route path="/login" element={<LoginPage />} />
            </Routes>
          </main>

          {/* Footer */}
          <footer
            className="site-footer"
            style={{
              borderTop: '1px solid var(--border-light)',
              padding: '24px 32px',
              textAlign: 'center',
              backgroundColor: '#FFFFFF',
              color: 'var(--text-secondary)',
              fontSize: '13px',
            }}
          >
            <div className="site-footer-inner" style={{ maxWidth: '1640px', width: '100%', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="online-indicator" />
                <span>Backend Connected (Port 4000) • Socket.IO Live</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <img
                  src="/assets/investaplay-logo.png"
                  alt="InvestaPlay Studio"
                  style={{ width: '18px', height: '18px', objectFit: 'contain' }}
                />
                <span>© 2026 QuizzyFox • Powered by InvestaPlay Studio</span>
              </div>
            </div>
          </footer>
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
};

export default App;
