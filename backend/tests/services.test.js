const test = require('node:test');
const assert = require('node:assert/strict');

const authService = require('../src/services/auth.service');
const tournamentService = require('../src/services/tournament.service');
const userService = require('../src/services/user.service');
const roomService = require('../src/services/room.service');
const challengeService = require('../src/services/challenge.service');
const questionService = require('../src/services/question.service');

test('authService exports required API methods', () => {
  assert.equal(typeof authService.signup, 'function');
  assert.equal(typeof authService.login, 'function');
  assert.equal(typeof authService.guestLogin, 'function');
  assert.equal(typeof authService.socialLogin, 'function');
  assert.equal(typeof authService.refreshUserSession, 'function');
  assert.equal(typeof authService.revokeUserSession, 'function');
  assert.equal(typeof authService.requestPasswordReset, 'function');
  assert.equal(typeof authService.resetPassword, 'function');
});

test('authService.publicUser strips sensitive fields like password_hash', () => {
  const rawUser = {
    id: 'user-123',
    username: 'rahul',
    email: 'rahul@example.com',
    password_hash: 'secret_bcrypt_hash',
    token_version: 3,
    display_name: 'Rahul G',
    invite_code: 'INV123',
    avatar_url: 'https://avatar.png',
    role: 'player',
    is_guest: 0,
    xp: 250,
    level: 3,
    coins: 1500,
  };

  const safe = authService.publicUser(rawUser);
  assert.equal(safe.id, 'user-123');
  assert.equal(safe.username, 'rahul');
  assert.equal(safe.password_hash, undefined);
  assert.equal(safe.token_version, undefined);
  assert.equal(safe.coins, 1500);
});

test('tournamentService exports required API methods', () => {
  assert.equal(typeof tournamentService.listTournaments, 'function');
  assert.equal(typeof tournamentService.getTournamentPlayers, 'function');
  assert.equal(typeof tournamentService.createTournament, 'function');
  assert.equal(typeof tournamentService.getTournamentDetails, 'function');
  assert.equal(typeof tournamentService.joinTournament, 'function');
  assert.equal(typeof tournamentService.startTournament, 'function');
  assert.equal(typeof tournamentService.getTournamentLeaderboard, 'function');
  assert.equal(typeof tournamentService.generateAiQuestions, 'function');
  assert.equal(typeof tournamentService.playTournament, 'function');
  assert.equal(typeof tournamentService.completeTournamentAttempt, 'function');
});

test('userService exports required API methods', () => {
  assert.equal(typeof userService.getSystemStats, 'function');
  assert.equal(typeof userService.getGlobalPlayerStats, 'function');
  assert.equal(typeof userService.listUsersForAdmin, 'function');
  assert.equal(typeof userService.adjustCoinsAdmin, 'function');
  assert.equal(typeof userService.getUserProfile, 'function');
  assert.equal(typeof userService.getDailyBonusStatus, 'function');
  assert.equal(typeof userService.claimDailyBonus, 'function');
  assert.equal(typeof userService.recoverDailyStreak, 'function');
  assert.equal(typeof userService.getStreak, 'function');
  assert.equal(typeof userService.updateProfile, 'function');
  assert.equal(typeof userService.searchUsers, 'function');
  assert.equal(typeof userService.getFriends, 'function');
});

test('userService.getGlobalPlayerStats returns global database totals as numeric fields', async () => {
  const stats = await userService.getGlobalPlayerStats();
  assert.ok(stats, 'Stats should be defined');
  assert.equal(typeof stats.totalPlayers, 'number');
  assert.equal(typeof stats.activePlayers, 'number');
  assert.equal(typeof stats.guestPlayers, 'number');
  assert.equal(typeof stats.totalCoins, 'number');
  assert.ok(Number.isFinite(stats.totalPlayers));
  assert.ok(Number.isFinite(stats.activePlayers));
  assert.ok(Number.isFinite(stats.guestPlayers));
  assert.ok(Number.isFinite(stats.totalCoins));
});

test('roomService exports required API methods', () => {
  assert.equal(typeof roomService.getRoomSnapshot, 'function');
  assert.equal(typeof roomService.createRoom, 'function');
  assert.equal(typeof roomService.joinRoom, 'function');
  assert.equal(typeof roomService.togglePlayerReady, 'function');
  assert.equal(typeof roomService.startRoomGame, 'function');
});

test('challengeService exports required API methods', () => {
  assert.equal(typeof challengeService.challengeSnapshot, 'function');
  assert.equal(typeof challengeService.getSuggestions, 'function');
  assert.equal(typeof challengeService.listChallenges, 'function');
  assert.equal(typeof challengeService.createChallenge, 'function');
  assert.equal(typeof challengeService.acceptChallenge, 'function');
  assert.equal(typeof challengeService.declineChallenge, 'function');
  assert.equal(typeof challengeService.joinChallenge, 'function');
  assert.equal(typeof challengeService.completeChallenge, 'function');
});

test('questionService exports question and category management methods', () => {
  assert.equal(typeof questionService.listCategories, 'function');
  assert.equal(typeof questionService.createCategory, 'function');
  assert.equal(typeof questionService.deleteCategory, 'function');
  assert.equal(typeof questionService.listQuestions, 'function');
  assert.equal(typeof questionService.createQuestion, 'function');
  assert.equal(typeof questionService.deleteQuestion, 'function');
  assert.equal(typeof questionService.importQuestionsFromBuffer, 'function');
});

test.after(async () => {
  const { pool } = require('../src/db/pool');
  try {
    await pool.end();
  } catch {}
});
