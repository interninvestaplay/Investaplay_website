export interface User {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  level: number;
  coins: number;
  xp: number;
  avatarUrl?: string | null;
  equippedAvatar?: string;
  equippedFrame?: string;
  equippedTitle?: string;
  isGuest?: boolean;
}

export interface QuestionOption {
  key: 'A' | 'B' | 'C' | 'D';
  text: string;
}

export interface Question {
  id: string;
  text: string;
  options: string[] | Record<string, string>;
  category?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  explanation?: string;
  points?: number;
  timeLimit?: number;
}

export interface OnlinePlayer {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
  avatar?: string | null;
  level: number;
  score?: number;
  isOnline: boolean;
}

export interface RoomParticipant {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
  level: number;
  isHost: boolean;
  isReady: boolean;
  score?: number;
}

export interface Room {
  id: string;
  code: string;
  host_user_id: string;
  mode: string;
  category: string;
  difficulty: string;
  question_limit: number;
  max_players: number;
  status: 'waiting' | 'in_game' | 'completed' | 'cancelled';
  players: RoomParticipant[];
}

export interface IncomingChallengeData {
  challengeId: string;
  challengerId: string;
  challengerName: string;
  challengerAvatar?: string;
  quizType: string;
  topic?: string | null;
  difficulty?: string | null;
  questionCount?: number | null;
  endsAt?: string | null;
}
