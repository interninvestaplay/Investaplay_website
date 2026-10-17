const { query } = require('../db/pool');
const { startGame } = require('./game.service');
const { randomUUID } = require('crypto');

async function autoStartScheduledTournaments(io = null) {
  try {
    const { rows } = await query(
      `SELECT * FROM tournaments
       WHERE status = 'scheduled'
         AND starts_at <= NOW()`
    );

    const adminRes = await query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    const fallbackUserId = adminRes.rows[0]?.id;

    for (const item of rows) {
      console.log(`[TournamentScheduler] Auto-starting scheduled tournament: "${item.title}" (${item.id})`);
      try {
        const game = await startGame({
          tournamentId: item.id,
          mode: 'tournament',
          category: item.category,
          difficulty: item.difficulty,
          questionLimit: item.question_limit,
          createdBy: item.created_by || fallbackUserId,
        });

        // Register all players into game_scores table
        const players = await query('SELECT user_id FROM tournament_players WHERE tournament_id = $1', [item.id]);
        for (const player of players.rows) {
          await query(
            `INSERT IGNORE INTO game_scores (game_id, user_id, score, correct_answers)
             VALUES ($1, $2, 0, 0)`,
            [game.id, player.user_id]
          );
        }

        await query(
          `UPDATE tournaments
           SET status = 'in_progress', active_game_id = $2, updated_at = NOW()
           WHERE id = $1`,
          [item.id, game.id]
        );

        if (io) {
          io.emit('tournament:started', {
            tournamentId: item.id,
            gameId: game.id,
            title: item.title,
            category: item.category,
          });
        }
        console.log(`[TournamentScheduler] Tournament "${item.title}" is now LIVE! (Game: ${game.id})`);
      } catch (err) {
        console.error(`[TournamentScheduler] Error auto-starting tournament "${item.title}":`, err.message);
      }
    }
  } catch (error) {
    console.error('[TournamentScheduler] auto-start check error:', error.message);
  }
}

async function autoCompleteExpiredTournaments(io = null) {
  try {
    const { rows } = await query(
      `SELECT * FROM tournaments
       WHERE status = 'in_progress'
         AND ends_at IS NOT NULL
         AND ends_at <= NOW()`
    );

    for (const item of rows) {
      console.log(`[TournamentScheduler] Auto-completing expired tournament: "${item.title}" (${item.id})`);
      try {
        await query(
          `UPDATE tournaments
           SET status = 'completed', updated_at = NOW()
           WHERE id = $1`,
          [item.id]
        );

        if (io) {
          io.emit('tournament:completed', {
            tournamentId: item.id,
            title: item.title,
          });
        }
      } catch (err) {
        console.error(`[TournamentScheduler] Error auto-completing tournament "${item.title}":`, err.message);
      }
    }
  } catch (error) {
    console.error('[TournamentScheduler] auto-complete check error:', error.message);
  }
}

let schedulerTimer = null;

function startTournamentScheduler(io = null) {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
  }

  // Initial check on boot
  autoStartScheduledTournaments(io);
  autoCompleteExpiredTournaments(io);

  // Check every 10 seconds for real-time live start
  schedulerTimer = setInterval(() => {
    autoStartScheduledTournaments(io);
    autoCompleteExpiredTournaments(io);
  }, 10000);

  console.log('[TournamentScheduler] Auto-scheduler initialized (checks every 10 seconds).');
}

module.exports = {
  autoStartScheduledTournaments,
  autoCompleteExpiredTournaments,
  startTournamentScheduler,
};
