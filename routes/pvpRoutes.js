// routes/pvpRoutes.js - PvP API эндпоинты с ИСПРАВЛЕННЫМИ аватарками и статистикой

const express = require('express');
const router = express.Router();

// Импорты
const { pool } = require('../config/database');
const { LEAGUES, GAME_LIMITS } = require('../config/constants');
const { 
  getLeagueByPower,
  calculateCarScore,
  calculateBattleResult,
  updatePvPStats,
  checkPvPBattleLimit,
  cleanupOldResetFlags
} = require('../utils/gameLogic');

// Запускаем очистку старых флагов каждый час
setInterval(cleanupOldResetFlags, 60 * 60 * 1000);

// === PvP API ЭНДПОИНТЫ ===

// GET /api/pvp/league-info - Информация о лиге игрока
router.get('/league-info', async (req, res) => {
  try {
    const userId = req.query.userId || req.userId || 'default';
    
    // Получаем текущую машину и её мощность
    const userResult = await pool.query(`
      SELECT 
        u.user_id, u.first_name, u.game_coins, u.fuel_count,
        u.player_cars, u.selected_car_id
      FROM users u
      WHERE u.user_id = $1
    `, [userId]);
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    const user = userResult.rows[0];
    const playerCars = user.player_cars || [];
    const selectedCarId = user.selected_car_id;
    const currentCar = playerCars.find(car => car.id === selectedCarId) || playerCars[0];
    
    if (!currentCar) {
      return res.status(400).json({ error: 'Нет активной машины' });
    }
    
    const carPower = calculateCarScore(currentCar);
    const playerLeague = getLeagueByPower(carPower);
    
    // Получаем или создаем запись в pvp_leagues
    let pvpStats = await pool.query(
      'SELECT * FROM pvp_leagues WHERE user_id = $1',
      [userId]
    );
    
    if (pvpStats.rows.length === 0) {
      // Создаем новую запись
      pvpStats = await pool.query(`
        INSERT INTO pvp_leagues (user_id, current_league) 
        VALUES ($1, $2) 
        RETURNING *
      `, [userId, playerLeague]);
    } else {
      // Обновляем лигу если мощность машины изменилась
      if (pvpStats.rows[0].current_league !== playerLeague) {
        pvpStats = await pool.query(`
          UPDATE pvp_leagues 
          SET current_league = $2, last_league_update = NOW()
          WHERE user_id = $1 
          RETURNING *
        `, [userId, playerLeague]);
      }
    }
    
    const stats = pvpStats.rows[0];
    
    // Получаем позицию в рейтинге лиги
    const leaguePosition = await pool.query(`
      SELECT COUNT(*) + 1 as position
      FROM pvp_leagues 
      WHERE current_league = $1 
        AND (total_wins > $2 OR (total_wins = $2 AND total_losses < $3))
    `, [playerLeague, stats.total_wins, stats.total_losses]);
    
    res.json({
      success: true,
      data: {
        currentLeague: playerLeague,
        leagueInfo: LEAGUES[playerLeague],
        carPower,
        carName: currentCar.name,
        stats: stats,
        position: leaguePosition.rows[0]?.position || 1,
        canFight: user.fuel_count > 0
      }
    });
    
  } catch (error) {
    console.error('❌ Ошибка получения информации о лиге:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// GET /api/pvp/opponents - Поиск соперников (✅ ИСПРАВЛЕНО)
router.get('/opponents', async (req, res) => {
  try {
    const userId = req.query.userId || req.userId || 'default';
    
    // Получаем информацию о текущем игроке
    const userResult = await pool.query(`
      SELECT 
        u.user_id, u.first_name, u.game_coins, u.fuel_count,
        u.player_cars, u.selected_car_id
      FROM users u
      WHERE u.user_id = $1
    `, [userId]);
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    const user = userResult.rows[0];
    const playerCars = user.player_cars || [];
    const currentCar = playerCars.find(car => car.id === user.selected_car_id) || playerCars[0];
    
    if (!currentCar) {
      return res.status(400).json({ error: 'Нет активной машины' });
    }
    
    const playerPower = calculateCarScore(currentCar);
    const playerLeague = getLeagueByPower(playerPower);
    
    console.log(`👤 Игрок ${userId}: мощность ${playerPower}, лига ${playerLeague}`);
    
    // ✅ ИСПРАВЛЕНО: Поиск реальных игроков С АВАТАРКАМИ И СТАТИСТИКОЙ
    const realPlayersResult = await pool.query(`
      SELECT 
        u.user_id,
        u.first_name as username,
        u.player_photo,
        u.player_cars,
        u.selected_car_id,
        u.last_exit_time,
        COALESCE(p.total_wins, 0) as total_wins,
        COALESCE(p.total_losses, 0) as total_losses,
        COALESCE(p.current_league, $2) as current_league
      FROM users u
      LEFT JOIN pvp_leagues p ON u.user_id = p.user_id
      WHERE u.user_id != $1  
        AND u.player_cars IS NOT NULL 
        AND u.player_cars != '[]'
        AND u.selected_car_id IS NOT NULL
        AND u.last_exit_time > NOW() - INTERVAL '7 days'
      ORDER BY u.last_exit_time DESC
      LIMIT 3
    `, [userId, playerLeague]);

    const realPlayers = realPlayersResult.rows.map(player => {
      const playerCars = player.player_cars || [];
      const selectedCar = playerCars.find(car => car.id === player.selected_car_id) || playerCars[0];
      const carPower = selectedCar ? calculateCarScore(selectedCar) : 100;
      
      // ✅ ИСПРАВЛЕНО: Рассчитываем РЕАЛЬНЫЙ винрейт
      const totalGames = player.total_wins + player.total_losses;
      const winRate = totalGames > 0 ? Math.round((player.total_wins / totalGames) * 100) : 50;
      
      return {
        user_id: player.user_id,
        username: player.username || 'Игрок',
        player_photo: player.player_photo, // ✅ ДОБАВЛЕНО!
        car_name: selectedCar?.name || 'Неизвестная машина',
        car_power: carPower,
        total_wins: player.total_wins, // ✅ РЕАЛЬНАЯ статистика
        total_losses: player.total_losses, // ✅ РЕАЛЬНАЯ статистика
        current_league: player.current_league,
        type: 'player',
        last_active: player.last_exit_time,
        powerDifference: carPower - playerPower,
        winRate: winRate, // ✅ РЕАЛЬНЫЙ винрейт
        isOnline: (Date.now() - new Date(player.last_exit_time).getTime()) < 30 * 60 * 1000
      };
    }).filter(player => Math.abs(player.powerDifference) <= 100);
    
    console.log(`👥 Найдено реальных игроков: ${realPlayers.length}`);
    
    // 🤖 ПОИСК БОТОВ (без изменений)
    const bots = await pool.query(`
      SELECT 
        'bot_' || bot_id as user_id,
        bot_name as username,
        car_name,
        car_power,
        car_parts,
        wins as total_wins,
        losses as total_losses,
        league as current_league,
        'bot' as type,
        last_online as last_active
      FROM pvp_bots
      WHERE car_power BETWEEN $1 AND $2
        AND league = $3
        AND is_active = true
      ORDER BY RANDOM()
      LIMIT 8
    `, [playerPower - 50, playerPower + 50, playerLeague]);
    
    console.log(`🤖 Найдено ботов: ${bots.rows.length}`);
    
    // Объединяем и сортируем
    const allOpponents = [...realPlayers, ...bots.rows].map(opponent => {
      let realCarPower = opponent.car_power;
      
      // Для ботов рассчитываем реальную мощность на основе тюнинга
      if (opponent.type === 'bot' && opponent.car_parts) {
        const tempCar = {
          id: `bot_car_${opponent.user_id}`,
          parts: opponent.car_parts
        };
        realCarPower = calculateCarScore(tempCar);
        console.log(`🔍 Бот ${opponent.username}: базовая мощность ${opponent.car_power} → реальная ${realCarPower}`);
      }
      
      return {
        ...opponent,
        car_power: realCarPower,
        winRate: opponent.total_wins + opponent.total_losses > 0 
          ? Math.round((opponent.total_wins / (opponent.total_wins + opponent.total_losses)) * 100)
          : 50,
        powerDifference: realCarPower - playerPower,
        isOnline: opponent.type === 'bot' || 
          (new Date() - new Date(opponent.last_active)) < 30 * 60 * 1000,
        priority: opponent.type === 'player' ? 1 : 2
      };
    }).sort((a, b) => a.priority - b.priority);
    
    console.log(`⚔️ Итого соперников: ${allOpponents.length}`);
    
    res.json({
      success: true,
      data: {
        opponents: allOpponents,
        playerLeague,
        playerPower,
        entryFee: LEAGUES[playerLeague].entryFee
      }
    });
    
  } catch (error) {
    console.error('❌ Ошибка поиска соперников:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// POST /api/pvp/challenge - Вызвать на дуэль (✅ ИСПРАВЛЕНО)
router.post('/challenge', async (req, res) => {
  try {
    const { userId, opponentId, message } = req.body;
    const finalUserId = userId || req.userId || 'default';
    
    console.log('🔍 PvP Challenge Debug:', {
      userId: finalUserId,
      opponentId,
      timestamp: new Date().toISOString()
    });
    
    if (!opponentId) {
      return res.status(400).json({ error: 'Не указан соперник' });
    }
    
    if (opponentId === finalUserId) {
      return res.status(400).json({ error: 'Нельзя вызвать самого себя' });
    }
    
    // Проверяем лимит боев в час
    const battleLimit = await checkPvPBattleLimit(finalUserId, GAME_LIMITS.MAX_PVP_BATTLES_PER_HOUR);
    if (!battleLimit.canBattle) {
      return res.status(429).json({ 
        error: `Слишком много боев за час (${battleLimit.currentCount}/${battleLimit.maxAllowed}). Попробуйте позже или посмотрите рекламу.`
      });
    }
    
    // Получаем информацию о машине игрока
    const userResult = await pool.query(`
      SELECT 
        u.user_id, u.first_name, u.game_coins, u.fuel_count,
        u.player_cars, u.selected_car_id
      FROM users u
      WHERE u.user_id = $1
    `, [finalUserId]);
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    const user = userResult.rows[0];
    const playerCars = user.player_cars || [];
    const currentCar = playerCars.find(car => car.id === user.selected_car_id) || playerCars[0];
    
    if (!currentCar || user.fuel_count <= 0) {
      return res.status(400).json({ error: 'Недостаточно топлива для боя' });
    }
    
    const playerPower = calculateCarScore(currentCar);
    const playerLeague = getLeagueByPower(playerPower);
    const entryFee = LEAGUES[playerLeague].entryFee;
    
    // Проверяем баланс
    if (user.game_coins < entryFee) {
      return res.status(400).json({ error: 'Недостаточно монет для участия' });
    }
    
    // Списываем монеты
    await pool.query('UPDATE users SET game_coins = game_coins - $1 WHERE user_id = $2', [entryFee, finalUserId]);
    
    // 🤖 БОЙ С БОТОМ (без изменений)
    if (opponentId.startsWith('bot_')) {
      const botId = opponentId.replace('bot_', '');
      const bot = await pool.query('SELECT * FROM pvp_bots WHERE bot_id = $1', [botId]);
      
      if (bot.rows.length === 0) {
        await pool.query('UPDATE users SET game_coins = game_coins + $1 WHERE user_id = $2', [entryFee, finalUserId]);
        return res.status(400).json({ error: 'Бот не найден' });
      }
      
      const botData = bot.rows[0];
      
      // Создаем машину бота с реальным тюнингом
      let botCarParts = {};
      
      if (botData.car_parts && typeof botData.car_parts === 'object') {
        botCarParts = botData.car_parts;
        console.log(`🤖 Бот ${botData.bot_name} использует детальный тюнинг:`, botCarParts);
      } else {
        console.log(`⚠️ У бота ${botData.bot_name} нет детального тюнинга, создаем базовый`);
        const totalLevels = Math.min(20, Math.floor(botData.car_power / 20));
        botCarParts = {
          engine: { level: Math.floor(totalLevels * 0.4) },
          tires: { level: Math.floor(totalLevels * 0.3) },
          style_body: { level: Math.floor(totalLevels * 0.2) },
          reliability_base: { level: Math.floor(totalLevels * 0.1) }
        };
      }
      
      const botCar = {
        id: `bot_${botData.bot_id}`,
        name: botData.car_name,
        parts: botCarParts
      };
      
      console.log(`🏎️ Создана машина бота:`, {
        name: botCar.name,
        parts: botCar.parts,
        calculatedPower: calculateCarScore(botCar)
      });
      
      // Создаем вызов
      const challenge = await pool.query(`
        INSERT INTO pvp_challenges (
          from_user_id, to_user_id, league, entry_fee, from_car_power, to_car_power
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `, [finalUserId, opponentId, playerLeague, entryFee, playerPower, calculateCarScore(botCar)]);
      
      // Расчет боя
      const battleResult = calculateBattleResult(currentCar, botCar);
      const league = LEAGUES[playerLeague];
      
      const winnerReward = league.rewards.win;
      const loserReward = league.rewards.lose;
      
      const isPlayerWinner = battleResult.winner === 'attacker';
      const playerReward = isPlayerWinner ? winnerReward : loserReward;
      
      // Создаем запись матча
      await pool.query(`
        INSERT INTO pvp_matches (
          challenge_id, attacker_id, defender_id, league,
          attacker_car_power, defender_car_power,
          attacker_car_name, defender_car_name,
          winner, attacker_reward, defender_reward,
          attacker_score, defender_score, battle_details
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `, [
        challenge.rows[0].challenge_id, finalUserId, opponentId, playerLeague,
        playerPower, calculateCarScore(botCar),
        currentCar.name, botCar.name,
        battleResult.winner,
        isPlayerWinner ? winnerReward : loserReward,
        isPlayerWinner ? loserReward : winnerReward,
        battleResult.attackerScore, battleResult.defenderScore,
        JSON.stringify(battleResult)
      ]);
      
      // Выдаем награды игроку
      await pool.query('UPDATE users SET game_coins = game_coins + $1 WHERE user_id = $2', [playerReward, finalUserId]);
      
      // Тратим топливо
      await pool.query('UPDATE users SET fuel_count = fuel_count - 1 WHERE user_id = $1', [finalUserId]);
      
      // Обновляем статистику игрока
      await updatePvPStats(finalUserId, isPlayerWinner);
      
      // Обновляем статистику бота
      if (isPlayerWinner) {
        await pool.query('UPDATE pvp_bots SET losses = losses + 1 WHERE bot_id = $1', [botId]);
      } else {
        await pool.query('UPDATE pvp_bots SET wins = wins + 1 WHERE bot_id = $1', [botId]);
      }
      
      // Завершаем вызов
      await pool.query(`
        UPDATE pvp_challenges 
        SET status = 'completed', completed_at = NOW()
        WHERE challenge_id = $1
      `, [challenge.rows[0].challenge_id]);
      
      console.log(`🏆 Бой с ботом завершен: ${isPlayerWinner ? 'Победа' : 'Поражение'} игрока ${finalUserId}`);
      
      res.json({
        success: true,
        data: {
          matchResult: {
            winner: battleResult.winner,
            yourResult: isPlayerWinner ? 'win' : 'lose',
            yourReward: playerReward,
            battleDetails: battleResult
          }
        }
      });
      
    } else {
      // ✅ ИСПРАВЛЕНО: БОЙ С РЕАЛЬНЫМ ИГРОКОМ
      console.log(`👥 Бой с реальным игроком: ${opponentId}`);
      
      const opponentResult = await pool.query(`
        SELECT user_id, first_name, player_cars, selected_car_id 
        FROM users 
        WHERE user_id = $1
      `, [opponentId]);
      
      if (opponentResult.rows.length === 0) {
        await pool.query('UPDATE users SET game_coins = game_coins + $1 WHERE user_id = $2', [entryFee, finalUserId]);
        return res.status(400).json({ error: 'Игрок не найден' });
      }
      
      const opponent = opponentResult.rows[0];
      const opponentCars = opponent.player_cars || [];
      const opponentCar = opponentCars.find(car => car.id === opponent.selected_car_id) || opponentCars[0];
      
      if (!opponentCar) {
        await pool.query('UPDATE users SET game_coins = game_coins + $1 WHERE user_id = $2', [entryFee, finalUserId]);
        return res.status(400).json({ error: 'У соперника нет машины' });
      }
      
      // Создаем вызов
      const challenge = await pool.query(`
        INSERT INTO pvp_challenges (
          from_user_id, to_user_id, league, entry_fee, from_car_power, to_car_power
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `, [finalUserId, opponentId, playerLeague, entryFee, playerPower, calculateCarScore(opponentCar)]);
      
      // Автоматический бой
      const battleResult = calculateBattleResult(currentCar, opponentCar);
      const league = LEAGUES[playerLeague];
      
      const isPlayerWinner = battleResult.winner === 'attacker';
      const playerReward = isPlayerWinner ? league.rewards.win : league.rewards.lose;
      const opponentReward = isPlayerWinner ? league.rewards.lose : league.rewards.win;
      
      // Записываем матч
      await pool.query(`
        INSERT INTO pvp_matches (
          challenge_id, attacker_id, defender_id, league,
          attacker_car_power, defender_car_power,
          attacker_car_name, defender_car_name,
          winner, attacker_reward, defender_reward,
          attacker_score, defender_score, battle_details
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `, [
        challenge.rows[0].challenge_id, finalUserId, opponentId, playerLeague,
        playerPower, calculateCarScore(opponentCar),
        currentCar.name, opponentCar.name,
        battleResult.winner, playerReward, opponentReward,
        battleResult.attackerScore, battleResult.defenderScore,
        JSON.stringify(battleResult)
      ]);
      
      // Выдаем награды
      await pool.query('UPDATE users SET game_coins = game_coins + $1 WHERE user_id = $2', [playerReward, finalUserId]);
      await pool.query('UPDATE users SET game_coins = game_coins + $1 WHERE user_id = $2', [opponentReward, opponentId]);
      
      // Тратим топливо
      await pool.query('UPDATE users SET fuel_count = fuel_count - 1 WHERE user_id = $1', [finalUserId]);
      
      // ✅ ИСПРАВЛЕНО: Обновляем статистику ПРАВИЛЬНО
      await updatePvPStats(finalUserId, isPlayerWinner);
      await updatePvPStats(opponentId, !isPlayerWinner);
      
      // 🔔 Создаем уведомление для соперника
      const opponentWon = !isPlayerWinner;
      const notificationTitle = opponentWon ? '🏆 Победа в PvP!' : '💔 Поражение в PvP';
      const notificationMessage = `Игрок ${user.first_name || 'Неизвестный'} вызвал вас на дуэль. ${opponentWon ? 'Вы победили' : 'Вы проиграли'}! Получено: ${opponentReward} монет.`;

      await pool.query(`
        INSERT INTO user_notifications (user_id, type, title, message, data)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        opponentId, 
        'pvp_battle', 
        notificationTitle, 
        notificationMessage,
        JSON.stringify({
          opponent_name: user.first_name || 'Неизвестный',
          opponent_id: finalUserId,
          won: opponentWon,
          reward: opponentReward,
          match_id: challenge.rows[0].challenge_id
        })
      ]);

      console.log(`🔔 Уведомление создано для игрока ${opponentId}`);

      // Завершаем вызов
      await pool.query(`
        UPDATE pvp_challenges SET status = 'completed', completed_at = NOW()
        WHERE challenge_id = $1
      `, [challenge.rows[0].challenge_id]);
      
      res.json({
        success: true,
        data: {
          matchResult: {
            winner: battleResult.winner,
            yourResult: isPlayerWinner ? 'win' : 'lose',
            yourReward: playerReward,
            opponentName: opponent.first_name || 'Игрок',
            battleDetails: battleResult,
            isRealPlayer: true
          }
        }
      });
    }
    
  } catch (error) {
    console.error('❌ Ошибка создания вызова:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// POST /api/pvp/reset-limit - Сброс лимита PvP боев
router.post('/reset-limit', async (req, res) => {
  try {
    const { userId } = req.body;
    const finalUserId = userId || req.userId || 'default';
    
    console.log('🔄 Попытка сброса лимита PvP для пользователя:', finalUserId);
    
    if (!finalUserId || finalUserId === 'default') {
      return res.status(400).json({ 
        success: false, 
        error: 'Не указан пользователь' 
      });
    }
    
    // Проверяем существование пользователя
    const userResult = await pool.query(
      'SELECT user_id, first_name FROM users WHERE user_id = $1',
      [finalUserId]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Пользователь не найден' 
      });
    }
    
    // Проверяем текущий лимит боев
    const currentLimit = await checkPvPBattleLimit(finalUserId, GAME_LIMITS.MAX_PVP_BATTLES_PER_HOUR);
    
    if (currentLimit.canBattle) {
      return res.json({ 
        success: true, 
        message: 'Лимит уже не достигнут, сброс не нужен',
        data: {
          currentCount: currentLimit.currentCount,
          maxAllowed: currentLimit.maxAllowed,
          canBattle: true
        }
      });
    }
    
    // Помечаем матчи за последний час как "сброшенные"
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const resetTime = new Date().toISOString();
    
    const resetData = JSON.stringify({
      limit_reset: true,
      reset_time: resetTime
    });
    
    const updateResult = await pool.query(`
      UPDATE pvp_matches 
      SET battle_details = COALESCE(battle_details, '{}'::jsonb) || $3::jsonb
      WHERE (attacker_id = $1 OR defender_id = $1) 
        AND match_date > $2
        AND (
          battle_details IS NULL 
          OR battle_details->>'limit_reset' IS NULL 
          OR battle_details->>'limit_reset' != 'true'
        )
      RETURNING match_id, attacker_id, defender_id, match_date
    `, [finalUserId, oneHourAgo, resetData]);
    
    console.log(`✅ Помечено ${updateResult.rowCount} матчей как сброшенные`);
    
    // Проверяем результат
    const newLimit = await checkPvPBattleLimit(finalUserId, GAME_LIMITS.MAX_PVP_BATTLES_PER_HOUR);
    
    // Записываем в adsgram_rewards для аналитики
    try {
      const tableCheck = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'adsgram_rewards'
        );
      `);
      
      if (tableCheck.rows[0].exists) {
        await pool.query(`
          INSERT INTO adsgram_rewards (user_id, reward_type, reward_coins, block_id)
          VALUES ($1, 'pvp_limit_reset', 0, 'limit_reset_' || $2)
        `, [finalUserId, Date.now()]);
      }
    } catch (adsgramError) {
      console.log('⚠️ Ошибка записи в adsgram_rewards:', adsgramError.message);
    }
    
    res.json({ 
      success: true, 
      message: 'Лимит PvP боев успешно сброшен!',
      data: {
        canBattleNow: newLimit.canBattle,
        currentCount: newLimit.currentCount,
        maxAllowed: newLimit.maxAllowed,
        resetTime: resetTime,
        matchesReset: updateResult.rowCount
      }
    });
    
  } catch (error) {
    console.error('❌ КРИТИЧЕСКАЯ ОШИБКА сброса лимита PvP:', {
      message: error.message,
      stack: error.stack,
      userId: req.body?.userId,
      timestamp: new Date().toISOString()
    });
    
    res.status(500).json({ 
      success: false, 
      error: 'Внутренняя ошибка сервера при сбросе лимита',
      debug: error.message
    });
  }
});

// GET /api/pvp/debug-limit - Отладочный эндпоинт для проверки лимитов
router.get('/debug-limit', async (req, res) => {
  try {
    const userId = req.query.userId || req.userId || 'default';
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    // Все матчи за час
    const allMatches = await pool.query(`
      SELECT 
        match_id, 
        attacker_id, 
        defender_id, 
        match_date, 
        battle_details,
        CASE 
          WHEN attacker_id = $1 THEN 'attacker'
          ELSE 'defender'
        END as role
      FROM pvp_matches 
      WHERE (attacker_id = $1 OR defender_id = $1)
      AND match_date > $2
      ORDER BY match_date DESC
    `, [userId, oneHourAgo]);
    
    // Только активные (не сброшенные)
    const activeMatches = allMatches.rows.filter(match => 
      !match.battle_details || 
      !match.battle_details.limit_reset || 
      match.battle_details.limit_reset !== 'true'
    );
    
    const currentLimit = await checkPvPBattleLimit(userId, GAME_LIMITS.MAX_PVP_BATTLES_PER_HOUR);
    
    res.json({
      success: true,
      data: {
        userId,
        timeWindow: {
          from: oneHourAgo.toISOString(),
          to: new Date().toISOString()
        },
        matches: {
          total: allMatches.rows.length,
          active: activeMatches.length,
          reset: allMatches.rows.length - activeMatches.length
        },
        limit: currentLimit,
        allMatchesDetails: allMatches.rows,
        activeMatchesDetails: activeMatches
      }
    });
    
  } catch (error) {
    console.error('❌ Ошибка отладки лимитов:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// GET /api/pvp/match-history - История боев (✅ ИСПРАВЛЕНО)
router.get('/match-history', async (req, res) => {
  try {
    const userId = req.query.userId || req.userId || 'default';
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    
    // ✅ ИСПРАВЛЕНО: Получаем РЕАЛЬНЫЕ имена игроков
    const matches = await pool.query(`
      SELECT 
        m.*,
        CASE 
          WHEN m.attacker_id = $1 THEN 
            CASE 
              WHEN m.defender_id LIKE 'bot_%' THEN b_def.bot_name 
              ELSE COALESCE(u_def.first_name, 'Игрок')
            END
          ELSE 
            CASE 
              WHEN m.attacker_id LIKE 'bot_%' THEN b_att.bot_name 
              ELSE COALESCE(u_att.first_name, 'Игрок')
            END
        END as opponent_name,
        CASE 
          WHEN m.attacker_id = $1 THEN m.defender_car_name
          ELSE m.attacker_car_name
        END as opponent_car,
        CASE 
          WHEN m.attacker_id = $1 THEN 'attacker'
          ELSE 'defender'
        END as your_role,
        CASE 
          WHEN (m.attacker_id = $1 AND m.winner = 'attacker') OR 
               (m.defender_id = $1 AND m.winner = 'defender')
          THEN 'win' ELSE 'lose'
        END as result
      FROM pvp_matches m
      LEFT JOIN pvp_bots b_att ON m.attacker_id = 'bot_' || b_att.bot_id
      LEFT JOIN pvp_bots b_def ON m.defender_id = 'bot_' || b_def.bot_id
      LEFT JOIN users u_att ON m.attacker_id = u_att.user_id AND m.attacker_id NOT LIKE 'bot_%'
      LEFT JOIN users u_def ON m.defender_id = u_def.user_id AND m.defender_id NOT LIKE 'bot_%'
      WHERE m.attacker_id = $1 OR m.defender_id = $1
      ORDER BY m.match_date DESC
      LIMIT $2 OFFSET $3
    `, [userId, limit, offset]);
    
    const totalCount = await pool.query(`
      SELECT COUNT(*) as count FROM pvp_matches 
      WHERE attacker_id = $1 OR defender_id = $1
    `, [userId]);
    
    res.json({
      success: true,
      data: {
        matches: matches.rows,
        pagination: {
          page,
          limit,
          total: parseInt(totalCount.rows[0]?.count || 0),
          totalPages: Math.ceil((totalCount.rows[0]?.count || 0) / limit)
        }
      }
    });
    
  } catch (error) {
    console.error('❌ Ошибка получения истории боев:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// 🆕 GET /api/pvp/bots-stats - Статистика ботов (для отладки)
router.get('/bots-stats', async (req, res) => {
  try {
    const botsStats = await pool.query(`
      SELECT 
        bot_name,
        car_name,
        car_power,
        car_parts,
        league,
        wins,
        losses,
        CASE 
          WHEN wins + losses > 0 THEN ROUND((wins::float / (wins + losses)) * 100, 1)
          ELSE 0
        END as win_rate,
        last_online,
        is_active
      FROM pvp_bots
      ORDER BY car_power ASC
    `);
    
    // Группируем по лигам
    const byLeague = {};
    botsStats.rows.forEach(bot => {
      if (!byLeague[bot.league]) {
        byLeague[bot.league] = [];
      }
      byLeague[bot.league].push(bot);
    });
    
    res.json({
      success: true,
      data: {
        totalBots: botsStats.rows.length,
        activeBots: botsStats.rows.filter(bot => bot.is_active).length,
        byLeague,
        allBots: botsStats.rows
      }
    });
    
  } catch (error) {
    console.error('❌ Ошибка получения статистики ботов:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

module.exports = router;