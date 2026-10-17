// API client for QuizWeb communicating with Backend_Quiz

const TOKEN_KEY = 'quizzyfox_access_token';
const REFRESH_KEY = 'quizzyfox_refresh_token';
const USER_KEY = 'quizzyfox_user_session';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY) || localStorage.getItem('investaplay_access_token');
}

export function setStoredToken(token: string | null) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem('investaplay_access_token');
  }
}

export function getStoredRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

export function setStoredRefreshToken(token: string | null) {
  if (token) {
    localStorage.setItem(REFRESH_KEY, token);
  } else {
    localStorage.removeItem(REFRESH_KEY);
  }
}

export function clearAllStoredAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem('investaplay_access_token');
}

export function getStoredUser(): any | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setStoredUser(user: any | null) {
  if (user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(USER_KEY);
  }
}

async function request<T>(endpoint: string, options: RequestInit = {}, isRetry = false): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(endpoint, {
    ...options,
    headers,
  });

  const text = await response.text();
  let data: any = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }

  // Handle 401 Unauthorized / Expired token with automatic refresh
  if (
    response.status === 401 &&
    !isRetry &&
    !endpoint.includes('/api/auth/login') &&
    !endpoint.includes('/api/auth/register') &&
    !endpoint.includes('/api/auth/refresh')
  ) {
    const refreshToken = getStoredRefreshToken();
    if (refreshToken) {
      try {
        const refreshRes = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (refreshRes.ok) {
          const refreshData = await refreshRes.json();
          const newAccess = refreshData.accessToken || refreshData.tokens?.accessToken;
          const newRefresh = refreshData.tokens?.refreshToken || refreshToken;
          if (newAccess) {
            setStoredToken(newAccess);
            if (newRefresh) setStoredRefreshToken(newRefresh);
            if (refreshData.user) setStoredUser(refreshData.user);
            return request<T>(endpoint, options, true);
          }
        }
      } catch (err) {
        console.warn('[API] Background token refresh failed:', err);
      }
    }
    // If refresh not possible or failed, clear stale auth and notify app
    clearAllStoredAuth();
    window.dispatchEvent(new CustomEvent('auth:expired'));
  }

  if (!response.ok) {
    const error: any = new Error(data.error || data.message || `Request failed with status ${response.status}`);
    error.status = response.status;
    error.code = data.code;
    error.details = data.details;
    throw error;
  }

  return data as T;
}

export const api = {
  // Auth
  async login(payload: { username?: string; email?: string; password: string }) {
    const res = await request<{
      accessToken?: string;
      tokens?: { accessToken: string; refreshToken?: string };
      user: any;
    }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        ...payload,
        identifier: payload.username || payload.email,
      }),
    });
    const token = res.accessToken || res.tokens?.accessToken || null;
    const refreshToken = res.tokens?.refreshToken || null;
    setStoredToken(token);
    if (refreshToken) setStoredRefreshToken(refreshToken);
    setStoredUser(res.user);
    return { ...res, accessToken: token };
  },

  async signup(payload: { username: string; email: string; password: string; displayName?: string }) {
    const res = await request<{
      accessToken?: string;
      tokens?: { accessToken: string; refreshToken?: string };
      user: any;
    }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const token = res.accessToken || res.tokens?.accessToken || null;
    const refreshToken = res.tokens?.refreshToken || null;
    setStoredToken(token);
    if (refreshToken) setStoredRefreshToken(refreshToken);
    setStoredUser(res.user);
    return { ...res, accessToken: token };
  },

  async guestLogin(displayName?: string) {
    const res = await request<{ accessToken: string; user: any }>('/api/auth/guest', {
      method: 'POST',
      body: JSON.stringify({ displayName: displayName || `Guest_${Math.floor(1000 + Math.random() * 9000)}` }),
    });
    setStoredToken(res.accessToken);
    setStoredUser(res.user);
    return res;
  },

  async me() {
    return request<{ user: any }>('/api/auth/me');
  },

  // Quick Quiz AI
  async getOnlinePlayers() {
    return request<{ players: any[] }>('/api/quick-quiz/online-players');
  },

  async generateTopicQuiz(payload: { topic: string; difficulty?: string; questionCount?: number }) {
    return request<{ sessionId: string; questions: any[]; questionCount: number }>('/api/quick-quiz/generate', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async uploadPdfQuiz(file: File, difficulty: string, questionCount: number) {
    const formData = new FormData();
    formData.append('pdf', file);
    formData.append('difficulty', difficulty);
    formData.append('questionCount', String(questionCount));

    return request<{ sessionId: string; session: any; questions: any[] }>('/api/quick-quiz/upload-pdf', {
      method: 'POST',
      body: formData,
    });
  },

  async createQuickQuizChallenge(payload: {
    targetUserId: string;
    sourceType?: string;
    topic: string;
    difficulty?: string;
    questionCount?: number;
    sessionId?: string;
  }) {
    return request<{ success: boolean; challenge: any; sessionId: string; questions: any[]; message: string }>(
      '/api/quick-quiz/challenge',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
  },

  async getQuickQuizSession(id: string) {
    return request<{ session: any; questions: any[] }>(`/api/quick-quiz/session/${id}`);
  },

  // Challenges
  async getChallenges() {
    return request<{ challenges: any[] }>('/api/challenges');
  },

  async acceptChallenge(challengeId: string) {
    return request<{ challenge: any; roomId: string; gameId?: string }>(`/api/challenges/${challengeId}/accept`, {
      method: 'POST',
    });
  },

  async declineChallenge(challengeId: string) {
    return request<{ declined: boolean }>(`/api/challenges/${challengeId}/decline`, {
      method: 'POST',
    });
  },

  async cancelChallenge(challengeId: string) {
    return request<{ cancelled: boolean }>(`/api/challenges/${challengeId}/cancel`, {
      method: 'POST',
    });
  },

  // Rooms & Multiplayer
  async getRoom(roomId: string) {
    return request<{ room: any; players: any[]; game?: any }>(`/api/rooms/${roomId}`);
  },

  async createRoom(payload: { category?: string; difficulty?: string; questionLimit?: number; isPrivate?: boolean }) {
    return request<{ room: any; code: string }>('/api/rooms', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async joinRoomByCode(code: string) {
    return request<{ room: any }>(`/api/rooms/join/${code}`, {
      method: 'POST',
    });
  },

  async startRoomGame(roomId: string) {
    return request<{ game: any; question: any }>(`/api/rooms/${roomId}/start`, {
      method: 'POST',
    });
  },

  async toggleRoomReady(roomId: string, ready: boolean) {
    return request<{ room: any; players: any[] }>(`/api/rooms/${roomId}/ready`, {
      method: 'PATCH',
      body: JSON.stringify({ ready }),
    });
  },

  async leaveRoom(roomId: string) {
    return request<{ cancelled: boolean }>(`/api/rooms/${roomId}/leave`, {
      method: 'POST',
    });
  },

  // Leaderboard & User
  async getLeaderboard(period: string = 'weekly') {
    return request<{ leaderboard: any[] }>(`/api/users/leaderboard?period=${period}`);
  },

  async claimDailyStreak() {
    return request<{ reward: any; coins: number; streak: number }>('/api/users/daily-streak/claim', {
      method: 'POST',
    });
  },
};
