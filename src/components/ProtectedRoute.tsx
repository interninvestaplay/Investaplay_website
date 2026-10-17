import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div
        style={{
          minHeight: '60vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '16px',
        }}
      >
        <img
          src="/assets/quizzyfox.png"
          alt="Loading..."
          className="float-effect"
          style={{ width: '80px', height: '80px', objectFit: 'contain' }}
        />
        <div style={{ color: 'var(--text-secondary)', fontSize: '15px', fontWeight: 600 }}>
          Verifying session...
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location, message: 'Please Sign In or Register to play!' }} replace />;
  }

  return <>{children}</>;
};
