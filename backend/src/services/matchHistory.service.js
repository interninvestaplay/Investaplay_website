const { query, connect } = require('../db/pool');
const { randomUUID } = require('crypto');
const { updateSkillScoreAfterMatch } = require('./skillScore.service');

async function saveMatchStatistics(gameId) {
  const client = await connect();
  let committed = false;
  try {
    await client.query('BEGIN');

    // Get game details
    const gameResult = await client.query(
      `SELECT * FROM games WHERE id = $1`,
      [gameId]
    );
    const game = gameResult.rows[0];

    // Get all players' scores and answers
    const scoresResult = await client.query(
      `SELECT gs.game_id, gs.user_id, gs.score, gs.correct_answers, gs.fast_answers,
              COUNT(a.id) as total_answers,
              SUM(CASE WHEN a.is_correct THEN 1 ELSE 0 END) as correct_count,
              SUM(CASE WHEN a.is_correct THEN 0 ELSE 1 END) as incorrect_count,
              AVG(a.answered_in_ms) as avg_response_time_ms,
              SUM(a.answered_in_ms) as total_time_ms,
              u.username, u.display_name
       FROM game_scores gs
       LEFT JOIN answers a ON a.game_id = gs.game_id AND a.user_id = gs.user_id
       JOIN users u ON u.id = gs.user_id
       WHERE gs.game_id = $1
       GROUP BY gs.user_id, gs.game_id
       ORDER BY gs.score DESC`,
      [gameId]
    );

    const scores = scoresResult.rows;
    const totalPlayers = scores.length;
    const existingHistory = await client.query('SELECT COUNT(*) AS total FROM user_match_history WHERE game_id = $1', [gameId]);
    const isFirstSave = Number(existingHistory.rows[0]?.total || 0) === 0;
    const newSkillUpdates = [];

    if (totalPlayers === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    // Calculate rankings and accuracy percentages
    const rankedScores = scores.map((score, index) => {
      const totalAnswered = Number(score.total_answers) || 0;
      const correctCount = Number(score.correct_count) || 0;
      const accuracy = totalAnswered > 0 ? (correctCount / totalAnswered) * 100 : 0;

      return {
        ...score,
        rank: index + 1,
        accuracy_percentage: accuracy,
        incorrect_count: Number(score.incorrect_count) || 0,
      };
    });

    // Get category and difficulty from game questions
    const categoryResult = await client.query(
      `SELECT q.category, q.difficulty
       FROM game_questions gq
       JOIN questions q ON q.id = gq.question_id
       WHERE gq.game_id = $1
       LIMIT 1`,
      [gameId]
    );

    const categoryData = categoryResult.rows[0] || { category: 'General', difficulty: 'easy' };

    // Save match history for each player
    const opponentUserIds = scores.map(s => s.user_id);

    for (const playerScore of rankedScores) {
      const matchHistoryId = randomUUID();
      const opponents = opponentUserIds.filter(id => id !== playerScore.user_id);
      const isWinner = game.mode === 'ai'
        ? Number(playerScore.correct_count || 0) >= 6
        : (playerScore.rank === 1 && (totalPlayers > 1 ? true : Number(playerScore.correct_count || 0) >= 6));

      const existingRecord = await client.query(
        'SELECT id FROM user_match_history WHERE game_id = $1 AND user_id = $2',
        [gameId, playerScore.user_id]
      );

      if (existingRecord.rows.length === 0) {
        await client.query(
          `INSERT INTO user_match_history (
             id, game_id, room_id, user_id, opponent_user_ids,
             score, \`rank\`, total_players, correct_answers, incorrect_answers,
             total_time_ms, avg_response_time_ms, accuracy_percentage,
             is_winner, completion_status, category, difficulty
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
          [
            matchHistoryId,
            gameId,
            game.room_id || null,
            playerScore.user_id,
            JSON.stringify(opponents),
            playerScore.score,
            playerScore.rank,
            totalPlayers,
            playerScore.correct_count || 0,
            playerScore.incorrect_count || 0,
            playerScore.total_time_ms || 0,
            playerScore.avg_response_time_ms || 0,
            playerScore.accuracy_percentage,
            isWinner,
            'completed',
            categoryData.category,
            categoryData.difficulty,
          ]
        );
        newSkillUpdates.push({ userId: playerScore.user_id, rank: playerScore.rank, score: playerScore.score, correctAnswers: playerScore.correct_count, mode: game.mode, totalPlayers, isWinner });
      }

      // Update game_scores with rank and completion details
      await client.query(
        `UPDATE game_scores 
         SET \`rank\` = $2, 
             total_time_ms = $3,
             avg_response_time_ms = $4,
             incorrect_answers = $5,
             completion_status = 'completed'
         WHERE game_id = $1 AND user_id = $6`,
        [
          gameId,
          playerScore.rank,
          playerScore.total_time_ms || 0,
          Math.round(playerScore.avg_response_time_ms || 0),
          playerScore.incorrect_count || 0,
          playerScore.user_id,
        ]
      );
    }

    // Mark game as completed
    await client.query(
      `UPDATE games SET status = 'completed', ended_at = NOW() WHERE id = $1`,
      [gameId]
    );

    // Update room status if applicable
    if (game.room_id) {
      await client.query(
        `UPDATE rooms SET status = 'completed', updated_at = NOW() WHERE id = $1`,
        [game.room_id]
      );

      // Count this game only once when statistics are retried.
      if (isFirstSave) {
      // Update room statistics
      const roomStatsResult = await client.query(
        `SELECT * FROM room_stats WHERE room_id = $1`,
        [game.room_id]
      );

      if (roomStatsResult.rows.length > 0) {
        await client.query(
          `UPDATE room_stats 
           SET total_games = total_games + 1,
               updated_at = NOW()
           WHERE room_id = $1`,
          [game.room_id]
        );
      } else {
        await client.query(
          `INSERT INTO room_stats (room_id, total_games)
           VALUES ($1, 1)`,
          [game.room_id]
        );
      }
      }
    }

    await client.query('COMMIT');
    committed = true;

    // Skill calculations read match history through the pool, so run them only
    // after the history transaction is visible to other connections.
    for (const update of newSkillUpdates) {
      await updateSkillScoreAfterMatch(update.userId, update);
    }

    return {
      gameId,
      totalPlayers,
      rankedScores: rankedScores.map(s => ({
        userId: s.user_id,
        username: s.username,
        displayName: s.display_name,
        rank: s.rank,
        score: s.score,
        correctAnswers: s.correct_count,
        incorrectAnswers: s.incorrect_count,
        accuracyPercentage: s.accuracy_percentage,
        totalTimeMs: s.total_time_ms,
        avgResponseTimeMs: Math.round(s.avg_response_time_ms || 0),
      })),
    };
  } catch (error) {
    if (!committed) await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getGameStatistics(gameId) {
  const { rows } = await query(
    `SELECT 
       umh.id,
       umh.user_id,
       umh.score,
       umh.\`rank\`,
       umh.total_players,
       umh.correct_answers,
       umh.incorrect_answers,
       umh.total_time_ms,
       umh.avg_response_time_ms,
       umh.accuracy_percentage,
       umh.is_winner,
       umh.category,
       umh.difficulty,
       umh.created_at,
       u.username,
       u.display_name,
       u.avatar_url
     FROM user_match_history umh
     JOIN users u ON u.id = umh.user_id
     WHERE umh.game_id = $1
     ORDER BY umh.\`rank\` ASC`,
    [gameId]
  );

  return rows.map(row => ({
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    rank: row.rank,
    score: row.score,
    totalPlayers: row.total_players,
    correctAnswers: row.correct_answers,
    incorrectAnswers: row.incorrect_answers,
    accuracyPercentage: Number(row.accuracy_percentage).toFixed(2),
    totalTimeMs: row.total_time_ms,
    avgResponseTimeMs: row.avg_response_time_ms,
    isWinner: row.is_winner,
    category: row.category,
    difficulty: row.difficulty,
    completedAt: row.created_at,
  }));
}

async function getRoomHistory(roomId, limit = 20, offset = 0) {
  const { rows: games } = await query(
    `SELECT 
       g.id as game_id,
       g.mode,
       g.status,
       g.started_at,
       g.ended_at,
       COUNT(DISTINCT gs.user_id) as player_count
     FROM games g
     LEFT JOIN game_scores gs ON gs.game_id = g.id
     WHERE g.room_id = $1
     GROUP BY g.id, g.mode, g.status, g.started_at, g.ended_at
     ORDER BY g.started_at DESC
     LIMIT $2 OFFSET $3`,
    [roomId, limit, offset]
  );

  // Get detailed statistics for each game
  const gameDetails = await Promise.all(
    games.map(async (game) => {
      const stats = await getGameStatistics(game.game_id);
      return {
        gameId: game.game_id,
        mode: game.mode,
        status: game.status,
        startedAt: game.started_at,
        endedAt: game.ended_at,
        playerCount: Number(game.player_count),
        statistics: stats,
      };
    })
  );

  return gameDetails;
}

async function getUserMatchHistory(userId, limit = 20, offset = 0) {
  const { rows } = await query(
    `SELECT 
       umh.id,
       umh.game_id,
       umh.room_id,
       umh.score,
       umh.\`rank\`,
       umh.total_players,
       umh.correct_answers,
       umh.incorrect_answers,
       umh.total_time_ms,
       umh.avg_response_time_ms,
       umh.accuracy_percentage,
       umh.is_winner,
       umh.category,
       umh.difficulty,
       umh.created_at,
       (SELECT COUNT(*) FROM user_match_history 
        WHERE game_id = umh.game_id) as total_in_game
     FROM user_match_history umh
     WHERE umh.user_id = $1
     ORDER BY umh.created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );

  return rows.map(row => ({
    id: row.id,
    gameId: row.game_id,
    roomId: row.room_id,
    score: row.score,
    rank: row.rank,
    totalPlayers: row.total_players,
    correctAnswers: row.correct_answers,
    incorrectAnswers: row.incorrect_answers,
    totalTimeMs: row.total_time_ms,
    avgResponseTimeMs: row.avg_response_time_ms,
    accuracyPercentage: Number(row.accuracy_percentage).toFixed(2),
    isWinner: row.is_winner,
    category: row.category,
    difficulty: row.difficulty,
    completedAt: row.created_at,
  }));
}

module.exports = {
  saveMatchStatistics,
  getGameStatistics,
  getRoomHistory,
  getUserMatchHistory,
};
