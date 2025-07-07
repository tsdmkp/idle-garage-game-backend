const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();

const { 
  pool,
  checkAndRestoreFuel,
  initializeDatabase,
  initializeFriendsDatabase,
  initializeAdsgramDatabase,
  gracefulShutdown
} = require('./config/database');





// === ИМПОРТ КОНСТАНТ ===
const { 
  LEAGUES, 
  LEAGUE_POINTS, 
  BASE_CAR_STATS, 
  GAME_LIMITS, 
  REWARDS 
} = require('./config/constants');





// === PvP СИСТЕМА - КОНСТАНТЫ ===
// Добавить ПОСЛЕ require('dotenv').config();
// В server.js заменить LEAGUES на более сбалансированные награды:







// Функции расчета для PvP
function getLeagueByPower(carPower) {
  for (const [key, league] of Object.entries(LEAGUES)) {
    if (carPower >= league.minPower && carPower <= league.maxPower) {
      return key;
    }
  }
  return 'BRONZE';
}

function calculateCarScore(car) {
  if (!car || !car.parts) return 0;
  
 const base = BASE_CAR_STATS[car.id] || BASE_CAR_STATS['car_001'];
  
  let power = base.power;
  let speed = base.speed;
  let style = base.style;
  let reliability = base.reliability;
  
  if (car.parts.engine) power += (car.parts.engine.level || 0) * 5;
  if (car.parts.tires) speed += (car.parts.tires.level || 0) * 3;
  if (car.parts.style_body) style += (car.parts.style_body.level || 0) * 4;
  if (car.parts.reliability_base) reliability += (car.parts.reliability_base.level || 0) * 5;
  
  return power + speed + style + reliability;
}

function calculateBattleResult(attackerCar, defenderCar) {
  const attackerBasePower = calculateCarScore(attackerCar);
  const defenderBasePower = calculateCarScore(defenderCar);
  
  // 🎲 УЛУЧШЕННАЯ ФОРМУЛА БОЯ С БОЛЬШЕЙ СЛУЧАЙНОСТЬЮ
  // Базовый разброс ±20% вместо ±10%
  const attackerMultiplier = 0.8 + Math.random() * 0.4; // от 0.8 до 1.2
  const defenderMultiplier = 0.8 + Math.random() * 0.4; // от 0.8 до 1.2
  
  // 🎯 ДОБАВЛЯЕМ ФАКТОР "ВЕЗЕНИЯ" - дополнительный шанс на победу
  const luckFactor = Math.random();
  const attackerLuck = luckFactor < 0.1 ? 1.3 : 1.0; // 10% шанс на удачу (+30%)
  const defenderLuck = luckFactor > 0.9 ? 1.3 : 1.0; // 10% шанс на удачу (+30%)
  
  const attackerScore = attackerBasePower * attackerMultiplier * attackerLuck;
  const defenderScore = defenderBasePower * defenderMultiplier * defenderLuck;
  
  // 🏆 ОПРЕДЕЛЯЕМ ПОБЕДИТЕЛЯ
  const winner = attackerScore > defenderScore ? 'attacker' : 'defender';
  
  console.log('🥊 Результат боя:', {
    attackerPower: attackerBasePower,
    defenderPower: defenderBasePower,
    attackerFinalScore: Math.round(attackerScore),
    defenderFinalScore: Math.round(defenderScore),
    winner,
    attackerLuck: attackerLuck > 1 ? 'ВЕЗЕНИЕ!' : 'норма',
    defenderLuck: defenderLuck > 1 ? 'ВЕЗЕНИЕ!' : 'норма'
  });
  
  return {
    winner,
    attackerScore: Math.round(attackerScore * 100) / 100,
    defenderScore: Math.round(defenderScore * 100) / 100,
    margin: Math.abs(attackerScore - defenderScore),
    attackerHadLuck: attackerLuck > 1,
    defenderHadLuck: defenderLuck > 1
  };
}

const app = express();
const port = process.env.PORT || 3000;

// Проверка переменных окружения
console.log('Environment variables:');
console.log('DATABASE_URL:', process.env.DATABASE_URL ? '[DATABASE_URL configured]' : 'undefined');

// Функция для декодирования и проверки Telegram initData
const decodeInitData = (initData) => {
  try {
    // Парсим URL-encoded строку
    const params = new URLSearchParams(initData);
    const data = {};
    
    for (const [key, value] of params.entries()) {
      if (key === 'user') {
        data.user = JSON.parse(value);
      } else if (key === 'start_param' || key === 'startapp') {
        // Обрабатываем и start_param и startapp
        data.start_param = value;
        console.log(`🎯 Found ${key} in initData:`, value);
      } else {
        data[key] = value;
      }
    }
    
    console.log('🔍 Decoded initData keys:', Object.keys(data));
    console.log('🔍 start_param/startapp value:', data.start_param);
    return data;
  } catch (error) {
    console.error('❌ Error decoding initData:', error);
    throw error;
  }
};

// Middleware для обработки Telegram initData
app.use(async (req, res, next) => {
  const initDataHeader = req.headers['x-telegram-init-data'];
  
  if (initDataHeader) {
    try {
      console.log('📥 Raw initData header:', initDataHeader);
      const decodedData = decodeInitData(initDataHeader);
      
      if (decodedData.user) {
        req.userId = decodedData.user.id?.toString();
        req.firstName = decodedData.user.first_name || 'Игрок';
        req.username = decodedData.user.username;
      }
      
      // ВАЖНО: Извлекаем start_param для рефералов
      req.referralCode = decodedData.start_param;
      
      console.log(`✅ Valid Init Data for userId: ${req.userId}`);
      console.log(`👤 User name: ${req.firstName}`);
      console.log(`🔗 Start param from initData: ${req.referralCode}`);
      
      // Если start_param отсутствует, попробуем альтернативные способы
      if (!req.referralCode) {
        console.log('⚠️ start_param not found in initData');
        console.log('📋 Available initData keys:', Object.keys(decodedData));
        
        // Проверяем, может быть параметр в другом формате
        if (decodedData.startapp) {
          req.referralCode = decodedData.startapp;
          console.log('🔧 Found startapp parameter:', req.referralCode);
        }
      }
      
      next();
    } catch (error) {
      console.error('❌ Invalid X-Telegram-Init-Data header:', error);
      // Пропускаем для разработки, в продакшене можно вернуть 401
      next();
    }
  } else {
    // Для запросов без initData (например, из браузера для разработки)
    console.log('ℹ️ No X-Telegram-Init-Data header found');
    next();
  }
});


// Middleware
app.use(express.json());
app.use(cors({
  origin: '*', // Разрешить запросы от любого источника
  methods: ['GET', 'POST', 'PUT', 'PATCH'],
  allowedHeaders: ['Content-Type', 'X-Telegram-Init-Data'],
  credentials: true
}));


// Эндпоинт для получения состояния игры
app.get('/api/game_state', async (req, res) => {
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
app.post('/api/game_state', async (req, res) => {
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
app.post('/api/fuel/refill', async (req, res) => {
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
app.get('/api/fuel/status', async (req, res) => {
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
app.get('/api/leaderboard', async (req, res) => {
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

// Оставляем старый эндпоинт для совместимости
app.get('/leaderboard', async (req, res) => {
  console.log('⚠️ Deprecated endpoint /leaderboard called, redirecting to /api/leaderboard');
  req.url = '/api/leaderboard';
  return app._router.handle(req, res);
});


// GET /api/friends - получение данных о друзьях
app.get('/api/friends', async (req, res) => {
  const userId = req.query.userId || 'default';
  console.log('👥 Friends data request for:', userId);

  try {
    // Получаем список приглашенных друзей
    const friendsResult = await pool.query(`
      SELECT 
        ur.referred_id as user_id,
        ur.referred_name as first_name,
        ur.reward_coins,
        ur.claimed,
        ur.created_at as joined_at
      FROM user_referrals ur
      WHERE ur.referrer_id = $1
      ORDER BY ur.created_at DESC
    `, [userId]);

    // Считаем статистику
    const statsResult = await pool.query(`
      SELECT 
        COUNT(*) as total_invites,
        SUM(CASE WHEN claimed THEN reward_coins ELSE 0 END) as total_earned,
        COUNT(CASE WHEN NOT claimed THEN 1 END) as pending_count
      FROM user_referrals
      WHERE referrer_id = $1
    `, [userId]);

    // Получаем неполученные награды
    const pendingRewards = await pool.query(`
      SELECT referred_name as friend_name, reward_coins as coins
      FROM user_referrals
      WHERE referrer_id = $1 AND claimed = FALSE
    `, [userId]);

    const stats = statsResult.rows[0] || { total_invites: 0, total_earned: 0, pending_count: 0 };
    
    res.json({
      success: true,
      friends: friendsResult.rows,
      total_invites: parseInt(stats.total_invites) || 0,
      total_earned: parseInt(stats.total_earned) || 0,
      pending_rewards: pendingRewards.rows,
      referral_link: `ref_${userId}`
    });

  } catch (err) {
    console.error('❌ Error fetching friends data:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch friends data'
    });
  }
});

// POST /api/friends/claim - получение наград за рефералы
app.post('/api/friends/claim', async (req, res) => {
  const { userId } = req.body;
  console.log('🎁 Claiming referral rewards for:', userId);

  try {
    // Получаем все неполученные награды
    const pendingRewards = await pool.query(`
      SELECT id, reward_coins
      FROM user_referrals
      WHERE referrer_id = $1 AND claimed = FALSE
    `, [userId]);

    if (pendingRewards.rows.length === 0) {
      return res.json({
        success: true,
        message: 'No pending rewards',
        total_coins: 0
      });
    }

    // Считаем общую сумму
    const totalCoins = pendingRewards.rows.reduce((sum, reward) => sum + reward.reward_coins, 0);

    // Начинаем транзакцию
    await pool.query('BEGIN');

    try {
      // Отмечаем награды как полученные
      await pool.query(`
        UPDATE user_referrals 
        SET claimed = TRUE 
        WHERE referrer_id = $1 AND claimed = FALSE
      `, [userId]);

      // Добавляем монеты пользователю
      await pool.query(`
        UPDATE users 
        SET game_coins = game_coins + $1, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $2
      `, [totalCoins, userId]);

      await pool.query('COMMIT');

      console.log(`✅ Claimed ${totalCoins} coins for ${userId}`);

      res.json({
        success: true,
        total_coins: totalCoins,
        rewards_count: pendingRewards.rows.length
      });

    } catch (err) {
      await pool.query('ROLLBACK');
      throw err;
    }

  } catch (err) {
    console.error('❌ Error claiming referral rewards:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to claim rewards'
    });
  }
});



// Основной эндпоинт для валидации наград от Adsgram
app.get('/api/adsgram/reward', async (req, res) => {
  try {
    const { userid, blockId, amount } = req.query;
    
    console.log('📺 Adsgram reward callback received:', {
      userId: userid,
      blockId: blockId,
      amount: amount,
      timestamp: new Date().toISOString(),
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent')
    });

    // Валидация обязательных параметров
    if (!userid) {
      console.warn('⚠️ Missing userId parameter in Adsgram callback');
      return res.status(400).json({ 
        success: false, 
        error: 'Missing userId parameter' 
      });
    }

    // Проверяем что пользователь существует
    const userCheck = await pool.query(
      'SELECT user_id, game_coins FROM users WHERE user_id = $1',
      [userid]
    );

    if (userCheck.rows.length === 0) {
      console.warn('⚠️ User not found in Adsgram callback:', userid);
      return res.status(404).json({ 
        success: false, 
        error: 'User not found' 
      });
    }

    const currentCoins = parseInt(userCheck.rows[0].game_coins) || 0;

    // Определяем размер награды в зависимости от блока
    let rewardCoins = 100; // Базовая награда
    let rewardType = 'coins';
    
    // Настройки для разных типов блоков
    if (blockId) {
      const blockIdStr = blockId.toString();
      if (blockIdStr.includes('bonus') || blockIdStr.includes('main')) {
        // Основной блок - бонусные монеты
        rewardCoins = 100;
        rewardType = 'coins';
      } else if (blockIdStr.includes('consolation') || blockIdStr.includes('race')) {
        // Утешительный приз после гонки
        rewardCoins = 50;
        rewardType = 'coins';
      } else if (blockIdStr.includes('boost') || blockIdStr.includes('income')) {
        // Буст дохода - без монет, активируем буст отдельно
        rewardCoins = 0;
        rewardType = 'boost';
      } else if (blockIdStr.includes('shop') || blockIdStr.includes('help')) {
        // Помощь в магазине
        rewardCoins = 200;
        rewardType = 'coins';
      } else if (blockIdStr.includes('fuel') || blockIdStr === '12355') {
        // ⛽ Специальная награда для топливной системы
        rewardCoins = 0; // Не даем монеты, только восстанавливаем топливо
        rewardType = 'fuel';
      } else {
        // Неизвестный блок - базовая награда
        rewardCoins = 100;
        rewardType = 'coins';
      }
    }

    // Защита от спама наград (не больше 20 наград в час)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentRewardsCheck = await pool.query(`
      SELECT COUNT(*) as count 
      FROM adsgram_rewards 
      WHERE user_id = $1 
      AND created_at > $2
    `, [userid, oneHourAgo]);

    const recentRewardsCount = parseInt(recentRewardsCheck.rows[0]?.count) || 0;
    if (recentRewardsCount >= 20) {
      console.warn('🚨 Too many Adsgram rewards per hour for user:', userid, 'Count:', recentRewardsCount);
      return res.status(429).json({ 
        success: false, 
        error: 'Too many rewards per hour' 
      });
    }

    // Начинаем транзакцию
    await pool.query('BEGIN');

    try {
      let updateResult = null;
      
      if (rewardType === 'fuel') {
        // ⛽ Восстанавливаем топливо вместо выдачи монет
        updateResult = await pool.query(`
          UPDATE users 
          SET 
            fuel_count = 5,
            last_race_time = CURRENT_TIMESTAMP,
            fuel_refill_time = NULL,
            updated_at = CURRENT_TIMESTAMP
          WHERE user_id = $1
          RETURNING fuel_count, game_coins
        `, [userid]);

        console.log(`⛽ Adsgram fuel restore processed for user ${userid}: fuel tank refilled`);
      } else if (rewardCoins > 0) {
        // Начисляем монеты
        const newCoins = currentCoins + rewardCoins;
        
        updateResult = await pool.query(`
          UPDATE users 
          SET 
            game_coins = $1,
            last_collected_time = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
          WHERE user_id = $2
          RETURNING game_coins
        `, [newCoins, userid]);

        console.log(`💰 Adsgram reward processed: +${rewardCoins} coins for user ${userid} (${currentCoins} -> ${newCoins})`);
      }

      // Логируем награду для аналитики
      await pool.query(`
        INSERT INTO adsgram_rewards (user_id, block_id, reward_coins, reward_type, ip_address, user_agent, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
      `, [
        userid, 
        blockId || 'unknown', 
        rewardCoins, 
        rewardType,
        req.ip || req.connection.remoteAddress || 'unknown',
        req.get('User-Agent') || 'unknown'
      ]);

      await pool.query('COMMIT');

      // Возвращаем успешный ответ Adsgram серверу
      const response = {
        success: true,
        userId: userid,
        rewardCoins: rewardCoins,
        rewardType: rewardType,
        newBalance: updateResult ? parseInt(updateResult.rows[0].game_coins) : currentCoins,
        fuelCount: rewardType === 'fuel' && updateResult ? updateResult.rows[0].fuel_count : undefined,
        blockId: blockId,
        timestamp: new Date().toISOString(),
        message: rewardType === 'fuel' ? 'Fuel tank refilled successfully' : 'Reward processed successfully'
      };

      console.log('✅ Adsgram callback response:', response);
      res.status(200).json(response);

    } catch (transactionError) {
      await pool.query('ROLLBACK');
      throw transactionError;
    }

  } catch (error) {
    console.error('❌ Critical error in Adsgram reward callback:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      timestamp: new Date().toISOString()
    });
  }
});

// Получение статистики просмотров рекламы (опционально)
app.get('/api/adsgram/stats', async (req, res) => {
  try {
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId parameter required' });
    }

    // Статистика за последние 24 часа
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total_views,
        SUM(reward_coins) as total_coins_earned,
        COUNT(CASE WHEN reward_type = 'fuel' THEN 1 END) as fuel_refills,
        COUNT(DISTINCT block_id) as different_blocks,
        MIN(created_at) as first_view,
        MAX(created_at) as last_view
      FROM adsgram_rewards 
      WHERE user_id = $1 
      AND created_at > $2
    `, [userId, dayAgo]);

    const blockStats = await pool.query(`
      SELECT 
        block_id,
        reward_type,
        COUNT(*) as views,
        SUM(reward_coins) as coins
      FROM adsgram_rewards 
      WHERE user_id = $1 
      AND created_at > $2
      GROUP BY block_id, reward_type
      ORDER BY views DESC
    `, [userId, dayAgo]);

    res.json({
      success: true,
      userId: userId,
      period: '24h',
      summary: stats.rows[0] || {
        total_views: 0,
        total_coins_earned: 0,
        fuel_refills: 0,
        different_blocks: 0,
        first_view: null,
        last_view: null
      },
      byBlock: blockStats.rows
    });

  } catch (error) {
    console.error('❌ Error getting Adsgram stats:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get stats' 
    });
  }
});

// ========== ЗДОРОВЬЕ И МОНИТОРИНГ ==========

// Эндпоинт для проверки здоровья сервера
app.get('/api/health', async (req, res) => {
  try {
    // Проверяем подключение к базе данных
    const dbCheck = await pool.query('SELECT NOW() as server_time');
    
    // Проверяем основные таблицы
    const tablesCheck = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('users', 'user_referrals', 'adsgram_rewards')
    `);
    
    const tables = tablesCheck.rows.map(row => row.table_name);
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: {
        connected: true,
        server_time: dbCheck.rows[0].server_time
      },
      tables: {
        users: tables.includes('users'),
        user_referrals: tables.includes('user_referrals'),
        adsgram_rewards: tables.includes('adsgram_rewards')
      },
      fuel_system: {
        enabled: true,
        max_fuel: 5,
        refill_time_hours: 1
      }
    });
    
  } catch (error) {
    console.error('❌ Health check failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// Эндпоинт для получения статистики сервера (для администрации)
app.get('/api/admin/stats', async (req, res) => {
  try {
    // Общая статистика пользователей
    const userStats = await pool.query(`
      SELECT 
        COUNT(*) as total_users,
        COUNT(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as new_users_24h,
        COUNT(CASE WHEN last_exit_time > NOW() - INTERVAL '24 hours' THEN 1 END) as active_users_24h,
        AVG(player_level) as avg_level,
        AVG(game_coins) as avg_coins,
        AVG(fuel_count) as avg_fuel
      FROM users
    `);

    // Статистика топлива
    const fuelStats = await pool.query(`
      SELECT 
        COUNT(CASE WHEN fuel_count = 0 THEN 1 END) as users_no_fuel,
        COUNT(CASE WHEN fuel_count < 5 THEN 1 END) as users_low_fuel,
        COUNT(CASE WHEN fuel_refill_time IS NOT NULL THEN 1 END) as users_waiting_refill
      FROM users
    `);

    // Статистика рефералов
    const referralStats = await pool.query(`
      SELECT 
        COUNT(*) as total_referrals,
        COUNT(CASE WHEN claimed = false THEN 1 END) as pending_rewards,
        SUM(CASE WHEN claimed = true THEN reward_coins ELSE 0 END) as total_coins_paid
      FROM user_referrals
    `);

    // Статистика Adsgram
    const adsgramStats = await pool.query(`
      SELECT 
        COUNT(*) as total_views,
        COUNT(DISTINCT user_id) as unique_viewers,
        SUM(reward_coins) as total_coins_distributed,
        COUNT(CASE WHEN reward_type = 'fuel' THEN 1 END) as fuel_refills
      FROM adsgram_rewards
      WHERE created_at > NOW() - INTERVAL '24 hours'
    `);

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      users: userStats.rows[0],
      fuel: fuelStats.rows[0],
      referrals: referralStats.rows[0],
      adsgram_24h: adsgramStats.rows[0]
    });

  } catch (error) {
    console.error('❌ Error getting admin stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get admin stats'
    });
  }
});

// === PvP API ЭНДПОИНТЫ ===
// Добавить ПОСЛЕ всех существующих эндпоинтов, ПЕРЕД middleware для 404

// GET /api/pvp/league-info - Информация о лиге игрока
app.get('/api/pvp/league-info', async (req, res) => {
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
    console.error('Ошибка получения информации о лиге:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// GET /api/pvp/opponents - Поиск соперников
app.get('/api/pvp/opponents', async (req, res) => {
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
    
    const realPlayersResult = await pool.query(`
  SELECT 
    u.user_id,
    u.first_name as username,
    u.player_cars,
    u.selected_car_id,
    u.last_exit_time
  FROM users u
  WHERE u.user_id != $1  
    AND u.player_cars IS NOT NULL 
    AND u.player_cars != '[]'
    AND u.selected_car_id IS NOT NULL
    AND u.last_exit_time > NOW() - INTERVAL '7 days'
  ORDER BY u.last_exit_time DESC
  LIMIT 3
`, [userId]);

const realPlayers = realPlayersResult.rows.map(player => {
  const playerCars = player.player_cars || [];
  const selectedCar = playerCars.find(car => car.id === player.selected_car_id) || playerCars[0];
  const carPower = selectedCar ? calculateCarScore(selectedCar) : 100;
  
  return {
    user_id: player.user_id,
    username: player.username || 'Игрок',
    car_name: selectedCar?.name || 'Неизвестная машина',
    car_power: carPower,
    total_wins: 5, // Временные значения
    total_losses: 3,
    current_league: playerLeague,
    type: 'player',
    last_active: player.last_exit_time,
    powerDifference: carPower - playerPower,
    winRate: 60,
    isOnline: (Date.now() - new Date(player.last_exit_time).getTime()) < 30 * 60 * 1000
  };
}).filter(player => Math.abs(player.powerDifference) <= 100); // Только подходящие по силе
    
    // Поиск ботов
    const bots = await pool.query(`
      SELECT 
        'bot_' || bot_id as user_id,
        bot_name as username,
        car_name,
        car_power,
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
    
    // Объединяем и сортируем
    const allOpponents = [...realPlayers, ...bots.rows].map(opponent => ({
      ...opponent,
      winRate: opponent.total_wins + opponent.total_losses > 0 
        ? Math.round((opponent.total_wins / (opponent.total_wins + opponent.total_losses)) * 100)
        : 0,
      powerDifference: opponent.car_power - playerPower,
      isOnline: opponent.type === 'bot' || 
        (new Date() - new Date(opponent.last_active)) < 30 * 60 * 1000,
      priority: opponent.type === 'player' ? 1 : 2
    })).sort((a, b) => a.priority - b.priority);
    
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
    console.error('Ошибка поиска соперников:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// POST /api/pvp/challenge - Вызвать на дуэль
app.post('/api/pvp/challenge', async (req, res) => {
  try {
    const { userId, opponentId, message } = req.body;
    const finalUserId = userId || req.userId || 'default';
    
console.log('🔍 PvP Challenge Debug:', {
      userId: finalUserId,
      opponentId,
      timestamp: new Date().toISOString(),
      userAgent: req.get('User-Agent'),
      headers: req.headers
    });

    if (!opponentId) {
      return res.status(400).json({ error: 'Не указан соперник' });
    }
    
    if (opponentId === finalUserId) {
      return res.status(400).json({ error: 'Нельзя вызвать самого себя' });
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
    
    // Если это бот - автоматически проводим бой
    if (opponentId.startsWith('bot_')) {
      const botId = opponentId.replace('bot_', '');
      const bot = await pool.query('SELECT * FROM pvp_bots WHERE bot_id = $1', [botId]);
      
      if (bot.rows.length === 0) {
        // Возвращаем монеты
        await pool.query('UPDATE users SET game_coins = game_coins + $1 WHERE user_id = $2', [entryFee, finalUserId]);
        return res.status(400).json({ error: 'Бот не найден' });
      }
      
      // Создаем вызов
      const challenge = await pool.query(`
        INSERT INTO pvp_challenges (
          from_user_id, to_user_id, league, entry_fee, from_car_power, to_car_power
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `, [finalUserId, opponentId, playerLeague, entryFee, playerPower, bot.rows[0].car_power]);
      
      // Автоматический бой с ботом
      const botCar = {
        id: 'bot_car',
        name: bot.rows[0].car_name,
        parts: {
          engine: { level: Math.floor(bot.rows[0].car_power / 100) },
          tires: { level: 0 },
          style_body: { level: 0 },
          reliability_base: { level: 0 }
        }
      };
      
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
        playerPower, bot.rows[0].car_power,
        currentCar.name, bot.rows[0].car_name,
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
  // 👥 АВТОБОЙ С РЕАЛЬНЫМ ИГРОКОМ (упрощенная версия)
  console.log(`👥 Бой с реальным игроком: ${opponentId}`);
  
  // Получаем данные соперника
  const opponentResult = await pool.query(
    'SELECT user_id, first_name, player_cars, selected_car_id FROM users WHERE user_id = $1',
    [opponentId]
  );
  
  if (opponentResult.rows.length === 0) {
    // Возвращаем монеты
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
  
  // Обновляем статистику
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
        isRealPlayer: true // 🎮 ЭТО БЫЛ РЕАЛЬНЫЙ ИГРОК!
      }
    }
  });
}
    
  } catch (error) {
    console.error('Ошибка создания вызова:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// Функция обновления статистики PvP
async function updatePvPStats(userId, isWin) {
  try {
    const pointsChange = isWin ? LEAGUE_POINTS.win : LEAGUE_POINTS.lose;
    
    if (isWin) {
      await pool.query(`
        INSERT INTO pvp_leagues (user_id, total_wins, wins_today, league_points, win_streak, best_win_streak, last_battle_date, updated_at)
        VALUES ($1, 1, 1, $2, 1, 1, NOW(), NOW())
        ON CONFLICT (user_id) 
        DO UPDATE SET 
          total_wins = pvp_leagues.total_wins + 1,
          wins_today = pvp_leagues.wins_today + 1,
          league_points = pvp_leagues.league_points + $2,
          win_streak = pvp_leagues.win_streak + 1,
          best_win_streak = GREATEST(pvp_leagues.best_win_streak, pvp_leagues.win_streak + 1),
          last_battle_date = NOW(),
          updated_at = NOW()
      `, [userId, pointsChange]);
    } else {
      await pool.query(`
        INSERT INTO pvp_leagues (user_id, total_losses, losses_today, league_points, win_streak, last_battle_date, updated_at)
        VALUES ($1, 1, 1, GREATEST(0, $2), 0, NOW(), NOW())
        ON CONFLICT (user_id) 
        DO UPDATE SET 
          total_losses = pvp_leagues.total_losses + 1,
          losses_today = pvp_leagues.losses_today + 1,
          league_points = GREATEST(0, pvp_leagues.league_points + $2),
          win_streak = 0,
          last_battle_date = NOW(),
          updated_at = NOW()
      `, [userId, pointsChange]);
    }
    
  } catch (error) {
    console.error('Ошибка обновления статистики PvP:', error);
  }
}

// GET /api/pvp/match-history - История боев
app.get('/api/pvp/match-history', async (req, res) => {
  try {
    const userId = req.query.userId || req.userId || 'default';
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    
    const matches = await pool.query(`
      SELECT 
        m.*,
        CASE 
          WHEN m.attacker_id = $1 THEN 
            CASE WHEN m.defender_id LIKE 'bot_%' THEN b_def.bot_name ELSE 'Игрок' END
          ELSE 
            CASE WHEN m.attacker_id LIKE 'bot_%' THEN b_att.bot_name ELSE 'Игрок' END
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
    console.error('Ошибка получения истории боев:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

console.log('✅ PvP API endpoints initialized');

// В server.js добавить ПЕРЕД middleware для 404:

// 🔔 API для уведомлений
app.get('/api/notifications', async (req, res) => {
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
app.post('/api/notifications/mark-read', async (req, res) => {
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

console.log('🔔 Notifications API endpoints added');



// ========== ОБРАБОТКА ОШИБОК ==========

// Middleware для обработки 404 ошибок
app.use((req, res) => {
  console.log('❌ 404 Not Found:', req.method, req.url);
  res.status(404).json({
    error: 'Endpoint not found',
    method: req.method,
    url: req.url,
    timestamp: new Date().toISOString()
  });
});

// Middleware для обработки ошибок
app.use((err, req, res, next) => {
  console.error('❌ Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    timestamp: new Date().toISOString()
  });
});



// ========== ЗАПУСК СЕРВЕРА ==========

// Инициализируем базы данных и запускаем сервер
initializeDatabase()
  .then(() => initializeFriendsDatabase())
  .then(() => initializeAdsgramDatabase())
  .then(() => {
    const server = app.listen(port, () => {
      console.log(`🚀 Server running on port ${port}`);
      console.log(`⛽ Fuel system enabled (max: 5, refill: 1 hour)`);
      console.log(`👥 Friends system enabled`);
      console.log(`📺 Adsgram integration enabled`);
      console.log(`🎮 Game state endpoint: /api/game_state`);
      console.log(`🏆 Leaderboard endpoint: /api/leaderboard`);
      console.log(`🤝 Friends endpoint: /api/friends`);
      console.log(`⛽ Fuel endpoints: /api/fuel/refill, /api/fuel/status`);
      console.log(`📺 Adsgram webhook: /api/adsgram/reward`);
      console.log(`📈 Adsgram stats: /api/adsgram/stats`);
      console.log(`🏥 Health check: /api/health`);
      console.log(`📊 Admin stats: /api/admin/stats`);
    });
    
    // Обработка ошибки занятого порта
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`❌ Port ${port} is busy, trying ${port + 1}...`);
        setTimeout(() => {
          server.close();
          app.listen(port + 1, () => {
            console.log(`🚀 Server running on port ${port + 1}`);
          });
        }, 1000);
      } else {
        console.error('❌ Server error:', err);
      }
    });
  })
  .catch(err => {
    console.error('❌ Failed to initialize database:', err);
    process.exit(1);
  });