// routes/gameRoutes.js - Основные игровые эндпоинты

const express = require('express');
const router = express.Router();

// Импорты
const { pool, checkAndRestoreFuel } = require('../config/database');

// Эндпоинт для получения состояния игры
router.get('/game_state', async (req, res) => {
  // Приоритет: данные из initData, затем из query параметров
  const userId = req.userId || req.query.userId || 'default';
  const referralCode = req.referralCode || req.query.ref;
  const firstName = req.firstName || 'Игрок';
  
  console.log('📥 GET game_state for userId:', userId);
  console.log('🔗 Referral code:', referralCode);
  console.log('👤 First name:', firstName);
  console.log('📋 Headers present:', !!req.headers['x-telegram-init-data']);
  
  try {
    const result = await pool.query(`
      SELECT 
        user_id, first_name, username, player_level, game_coins, jet_coins,
        current_xp, xp_to_next_level, income_rate_per_hour,
        last_collected_time, last_exit_time, buildings, player_cars,
        hired_staff, has_completed_tutorial, invited_by, selected_car_id,
        fuel_count, last_race_time, fuel_refill_time,
        referral_bonus_received, created_at, updated_at
      FROM users 
      WHERE user_id = $1
    `, [userId]);
    
    if (result.rows.length === 0) {
      console.log('👤 Creating new user:', userId);
      
      // Обработка реферального кода
      let referrerId = null;
      let startingCoins = 500;
      
      if (referralCode && referralCode.startsWith('ref_')) {
        referrerId = referralCode.replace('ref_', '');
        
        // Проверяем, что пользователь не приглашает сам себя
        if (referrerId !== userId) {
          startingCoins += 100; // Бонус новичку
          console.log('👥 Valid referral! Referrer:', referrerId, 'New user bonus:', startingCoins);
        } else {
          console.log('⚠️ Self-referral detected, ignoring');
          referrerId = null;
        }
      } else if (referralCode) {
        console.log('⚠️ Invalid referral code format:', referralCode);
      } else {
        console.log('ℹ️ No referral code provided');
      }
      
      // Создаем нового пользователя с полным баком топлива
      const insertResult = await pool.query(`
        INSERT INTO users (
          user_id, first_name, username, player_level, game_coins, jet_coins, 
          current_xp, xp_to_next_level, buildings, player_cars, hired_staff,
          income_rate_per_hour, has_completed_tutorial, invited_by, selected_car_id,
          fuel_count, last_race_time, fuel_refill_time
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        RETURNING *
      `, [
        userId,
        firstName,
        req.username || null,
        1,
        startingCoins,
        0,
        10,
        100,
        JSON.stringify([
          { id: 'wash', name: 'car_wash', level: 1, icon: '🧼', isLocked: false },
          { id: 'service', name: 'service_station', level: 0, icon: '🔧', isLocked: false },
          { id: 'tires', name: 'tire_shop', level: 0, icon: '🛞', isLocked: false },
          { id: 'drift', name: 'drift_school', level: 0, icon: '🏁', isLocked: false }
        ]),
        JSON.stringify([{
          id: 'car_001',
          name: 'Ржавая "Копейка"',
          imageUrl: '/placeholder-car.png',
          stats: { power: 45, speed: 70, style: 5, reliability: 30 },
          parts: {
            engine: { level: 1, name: 'Двигатель' },
            tires: { level: 0, name: 'Шины' },
            style_body: { level: 0, name: 'Кузов (Стиль)' },
            reliability_base: { level: 1, name: 'Надежность (База)' }
          }
        }]),
        JSON.stringify({
          mechanic: 0, manager: 0, cleaner: 0, 
          security: 0, marketer: 0, accountant: 0
        }),
        15, // Базовый доход
        false,
        referrerId,
        'car_001',
        5, // ⛽ fuel_count - полный бак для нового игрока
        null, // last_race_time
        null  // fuel_refill_time
      ]);
      
      // Если есть валидный реферер, создаем запись о реферале
      if (referrerId) {
        // Проверяем, что реферер существует
        const referrerCheck = await pool.query(
          'SELECT user_id FROM users WHERE user_id = $1',
          [referrerId]
        );
        
        if (referrerCheck.rows.length > 0) {
          await pool.query(`
            INSERT INTO user_referrals (referrer_id, referred_id, referred_name, reward_coins, claimed)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (referred_id) DO NOTHING
          `, [referrerId, userId, firstName, 200, false]);
          
          console.log(`✅ Referral recorded: ${firstName} (${userId}) -> ${referrerId}`);
        } else {
          console.log('❌ Referrer not found in database:', referrerId);
        }
      }
      
      console.log('✅ New user created with full fuel tank');
      res.status(200).json(insertResult.rows[0]);
    } else {
      const user = result.rows[0];
      console.log('📦 Found existing user:', userId);
      
      // ⛽ Проверяем восстановление топлива при загрузке
      const fuelResult = checkAndRestoreFuel(
        user.fuel_count, 
        user.last_race_time, 
        user.fuel_refill_time
      );
      
      if (fuelResult.shouldRestore) {
        console.log(`⛽ Restoring fuel for user ${userId}: ${user.fuel_count} -> ${fuelResult.newFuel}`);
        
        // Обновляем топливо в базе данных
        const updateQuery = `
          UPDATE users 
          SET 
            fuel_count = $1,
            fuel_refill_time = $2,
            updated_at = CURRENT_TIMESTAMP
          WHERE user_id = $3
          RETURNING *
        `;
        
        const updatedResult = await pool.query(updateQuery, [
          fuelResult.newFuel,
          fuelResult.newRefillTime,
          userId
        ]);
        
        console.log('✅ Fuel restored and saved to database');
        res.status(200).json(updatedResult.rows[0]);
      } else {
        res.status(200).json(user);
      }
    }
  } catch (err) {
    console.error('❌ Error fetching game state:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Эндпоинт для обновления состояния игры
router.post('/game_state', async (req, res) => {
  const { userId, ...updateData } = req.body;
  const finalUserId = userId || 'default';
  console.log('📤 POST game_state for userId:', finalUserId, 'with data keys:', Object.keys(updateData));
  
  // ⛽ Логируем обновления топлива отдельно
  if (updateData.fuel_count !== undefined || updateData.last_race_time !== undefined || updateData.fuel_refill_time !== undefined) {
    console.log('⛽ Fuel system update:', {
      fuel_count: updateData.fuel_count,
      last_race_time: updateData.last_race_time,
      fuel_refill_time: updateData.fuel_refill_time
    });
  }
  
  try {
    const updates = [];
    const values = [];
    let paramCount = 1;
    
    for (const [key, value] of Object.entries(updateData)) {
      if (key !== 'userId') {
        updates.push(`${key} = $${paramCount}`);
        
        // Особая обработка для различных типов данных
        if (typeof value === 'object' && value !== null) {
          values.push(JSON.stringify(value));
        } else if (key.includes('time') && value) {
          // Убеждаемся, что временные поля корректно преобразуются
          values.push(new Date(value).toISOString());
        } else if (key === 'fuel_count') {
          // Валидация топлива (0-5)
          const validFuel = Math.min(Math.max(parseInt(value) || 0, 0), 5);
          values.push(validFuel);
        } else {
          values.push(value);
        }
        paramCount++;
      }
    }
    
    if (updates.length === 0) {
      console.warn('⚠️ No data to update for userId:', finalUserId);
      return res.status(400).json({ error: 'No data to update' });
    }
    
    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(finalUserId);
    
    const query = `
      UPDATE users 
      SET ${updates.join(', ')}
      WHERE user_id = $${paramCount}
      RETURNING *
    `;
    
    const result = await pool.query(query, values);
    
    if (result.rows.length === 0) {
      console.warn('⚠️ User not found for update:', finalUserId);
      return res.status(404).json({ error: 'User not found' });
    }
    
    console.log('✅ Updated user:', finalUserId);
    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('❌ Error updating game state:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ⛽ Новый эндпоинт для специального управления топливом
router.post('/fuel/refill', async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    console.log(`⛽ Manual fuel refill request for user: ${userId}`);

    const query = `
      UPDATE users 
      SET 
        fuel_count = 5,
        last_race_time = CURRENT_TIMESTAMP,
        fuel_refill_time = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
      RETURNING fuel_count, last_race_time, fuel_refill_time
    `;

    const result = await pool.query(query, [userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    console.log(`✅ Fuel manually refilled for user ${userId}`);
    res.json({
      success: true,
      message: 'Fuel refilled successfully',
      fuel_data: result.rows[0]
    });

  } catch (error) {
    console.error('❌ Error refilling fuel:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ⛽ Эндпоинт для получения статуса топлива
router.get('/fuel/status', async (req, res) => {
  try {
    const userId = req.query.userId;
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const query = `
      SELECT 
        fuel_count,
        last_race_time,
        fuel_refill_time,
        CASE 
          WHEN fuel_count >= 5 THEN false
          WHEN fuel_refill_time IS NOT NULL AND fuel_refill_time <= CURRENT_TIMESTAMP THEN true
          WHEN fuel_refill_time IS NULL AND last_race_time IS NOT NULL AND 
               (CURRENT_TIMESTAMP - last_race_time) >= INTERVAL '1 hour' THEN true
          ELSE false
        END as can_refill_now,
        CASE 
          WHEN fuel_count >= 5 THEN null
          WHEN fuel_refill_time IS NOT NULL THEN fuel_refill_time
          WHEN last_race_time IS NOT NULL THEN (last_race_time + INTERVAL '1 hour')
          ELSE null
        END as refill_available_at
      FROM users 
      WHERE user_id = $1
    `;

    const result = await pool.query(query, [userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      ...result.rows[0]
    });

  } catch (error) {
    console.error('❌ Error getting fuel status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ИСПРАВЛЕННЫЙ ПУТЬ: /api/leaderboard вместо /leaderboard
router.get('/leaderboard', async (req, res) => {
  const userId = req.query.userId || 'default';
  console.log('🏆 GET leaderboard for userId:', userId);

  try {
    // Проверяем, существует ли столбец income_rate_per_hour
    const columnCheck = await pool.query(`
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'income_rate_per_hour'
    `);
    
    if (columnCheck.rows.length === 0) {
      console.error('❌ Column income_rate_per_hour does not exist in users table');
      return res.status(500).json({ error: 'Database schema error: missing income_rate_per_hour column' });
    }

    // Получаем топ-10 игроков по доходу в час
    const topPlayersResult = await pool.query(`
      SELECT 
        user_id, 
        first_name, 
        player_level,
        income_rate_per_hour,
        game_coins
      FROM users 
      WHERE income_rate_per_hour IS NOT NULL AND income_rate_per_hour > 0
      ORDER BY income_rate_per_hour DESC, game_coins DESC 
      LIMIT 10
    `);

    console.log('🏆 Found top players:', topPlayersResult.rows.length);

    // Получаем место текущего игрока
    let currentPlayer = null;
    if (userId && userId !== 'default') {
      // Сначала получаем данные игрока
      const playerResult = await pool.query(
        'SELECT user_id, first_name, player_level, income_rate_per_hour, game_coins FROM users WHERE user_id = $1',
        [userId]
      );
      
      if (playerResult.rows.length > 0) {
        const playerData = playerResult.rows[0];
        
        // Считаем ранг игрока
        const rankResult = await pool.query(`
          SELECT COUNT(*) + 1 as rank
          FROM users 
          WHERE (income_rate_per_hour > $1) 
             OR (income_rate_per_hour = $1 AND game_coins > $2)
        `, [
          playerData.income_rate_per_hour || 0,
          playerData.game_coins || 0
        ]);
        
        currentPlayer = {
          ...playerData,
          rank: parseInt(rankResult.rows[0].rank)
        };
        
        console.log('🎯 Current player rank:', currentPlayer.rank);
      }
    }

    res.status(200).json({
      success: true,
      top_players: topPlayersResult.rows,
      current_player: currentPlayer,
      total_players: topPlayersResult.rows.length
    });

  } catch (err) {
    console.error('❌ Error fetching leaderboard:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch leaderboard data' 
    });
  }
});

// 🔔 API для уведомлений
router.get('/notifications', async (req, res) => {
  try {
    const userId = req.query.userId || req.userId || 'default';
    
    // Получаем непрочитанные уведомления
    const notifications = await pool.query(`
      SELECT id, type, title, message, data, created_at
      FROM user_notifications 
      WHERE user_id = $1 AND is_read = FALSE
      ORDER BY created_at DESC
      LIMIT 10
    `, [userId]);
    
    console.log(`🔔 Найдено уведомлений для ${userId}: ${notifications.rows.length}`);
    
    res.json({
      success: true,
      notifications: notifications.rows,
      count: notifications.rows.length
    });
    
  } catch (error) {
    console.error('❌ Ошибка получения уведомлений:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get notifications' 
    });
  }
});

// Отметить уведомления как прочитанные
router.post('/notifications/mark-read', async (req, res) => {
  try {
    const { userId, notificationIds } = req.body;
    const finalUserId = userId || req.userId || 'default';
    
    if (notificationIds && notificationIds.length > 0) {
      // Отмечаем конкретные уведомления
      await pool.query(`
        UPDATE user_notifications 
        SET is_read = TRUE 
        WHERE user_id = $1 AND id = ANY($2)
      `, [finalUserId, notificationIds]);
    } else {
      // Отмечаем все уведомления пользователя
      await pool.query(`
        UPDATE user_notifications 
        SET is_read = TRUE 
        WHERE user_id = $1 AND is_read = FALSE
      `, [finalUserId]);
    }
    
    console.log(`✅ Уведомления отмечены как прочитанные для ${finalUserId}`);
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('❌ Ошибка отметки уведомлений:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to mark notifications as read' 
    });
  }
});

module.exports = router;