const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Проверка переменных окружения
console.log('Environment variables:');
console.log('DATABASE_URL:', process.env.DATABASE_URL ? '[DATABASE_URL configured]' : 'undefined');

// Настройка PostgreSQL через CONNECTION_STRING
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false, // Отключаем SSL для вашего хостинга
  max: 20, // Максимальное количество соединений
  idleTimeoutMillis: 30000, // Время простоя соединения
  connectionTimeoutMillis: 5000 // Таймаут подключения
});

// Проверка подключения к базе
pool.connect((err, client, release) => {
  if (err) {
    console.error('Error acquiring client', err.stack);
  } else {
    console.log('Connected to PostgreSQL as:', client.user);
    release(); // Освобождаем клиент обратно в пул
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

// Инициализация таблицы при старте
const initializeDatabase = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(50) UNIQUE NOT NULL,
        first_name VARCHAR(100),
        username VARCHAR(100),
        player_level INTEGER DEFAULT 1,
        game_coins BIGINT DEFAULT 500,
        jet_coins INTEGER DEFAULT 0,
        current_xp INTEGER DEFAULT 10,
        xp_to_next_level INTEGER DEFAULT 100,
        last_collected_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_exit_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        buildings JSONB DEFAULT '[]',
        player_cars JSONB DEFAULT '[]',
        selected_car_id VARCHAR(50),
        hired_staff JSONB DEFAULT '{}',
        income_rate_per_hour INTEGER DEFAULT 0,
        has_completed_tutorial BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Добавляем недостающие столбцы если их нет
    try {
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_exit_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS has_completed_tutorial BOOLEAN DEFAULT FALSE`);
      console.log('✅ Database columns updated');
    } catch (alterErr) {
      console.log('ℹ️ Database columns already exist or update failed:', alterErr.message);
    }
    
    console.log('✅ Database table initialized successfully');
  } catch (err) {
    console.error('❌ Error initializing database:', err);
  }
};

// Эндпоинт для получения состояния игры
app.get('/api/game_state', async (req, res) => {
  const userId = req.query.userId || 'default';
  const referralCode = req.query.ref; // Получаем реферальный код
  console.log('📥 GET game_state for userId:', userId, 'referral:', referralCode);
  
  try {
    const result = await pool.query('SELECT * FROM users WHERE user_id = $1', [userId]);
    
    if (result.rows.length === 0) {
      console.log('👤 Creating new user:', userId);
      
      // Извлекаем ID реферера из кода
      let referrerId = null;
      let startingCoins = 500;
      
      if (referralCode && referralCode.startsWith('ref_')) {
        referrerId = referralCode.replace('ref_', '');
        startingCoins += 100; // Бонус новичку
        console.log('👥 Referral detected:', referrerId, 'bonus coins:', startingCoins);
      }
      
      // Создаем нового пользователя  
      const firstName = 'Игрок'; // По умолчанию, может быть передано из фронтенда
      const insertResult = await pool.query(`
        INSERT INTO users (
          user_id, first_name, username, player_level, game_coins, jet_coins, 
          current_xp, xp_to_next_level, buildings, player_cars, hired_staff,
          income_rate_per_hour, has_completed_tutorial, invited_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING *
      `, [
        userId,
        firstName,
        null,
        1,
        startingCoins,
        0,
        10,
        100,
        JSON.stringify([]),
        JSON.stringify([]),
        JSON.stringify({}),
        0,
        false,
        referrerId
      ]);
      
      // Если есть реферер, обрабатываем реферальную связь
      if (referrerId) {
        // Сначала проверяем, что реферер существует
        const referrerCheck = await pool.query(
          'SELECT user_id FROM users WHERE user_id = $1',
          [referrerId]
        );
        
        if (referrerCheck.rows.length > 0) {
          // Создаем запись о реферале с правильным именем
          await pool.query(`
            INSERT INTO user_referrals (referrer_id, referred_id, referred_name, reward_coins, claimed)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (referred_id) DO NOTHING
          `, [referrerId, userId, firstName, 200, false]);
          
          console.log(`✅ Referral link created: ${firstName} (${userId}) -> ${referrerId}`);
        } else {
          console.log('❌ Referrer not found:', referrerId);
        }
      }
      
      res.status(200).json(insertResult.rows[0]);
    } else {
      console.log('📦 Found existing user:', userId);
      res.status(200).json(result.rows[0]);
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
  
  try {
    const updates = [];
    const values = [];
    let paramCount = 1;
    
    for (const [key, value] of Object.entries(updateData)) {
      if (key !== 'userId') {
        updates.push(`${key} = $${paramCount}`);
        values.push(typeof value === 'object' ? JSON.stringify(value) : value);
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

// Инициализируем базу данных и запускаем сервер
initializeDatabase().then(() => {
  return initializeFriendsDatabase();
}).then(() => {
  const server = app.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
    console.log(`👥 Friends system enabled`);
    console.log(`📊 Leaderboard endpoint: /api/leaderboard`);
    console.log(`🎮 Game state endpoint: /api/game_state`);
    console.log(`🤝 Friends endpoint: /api/friends`);
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
}).catch(err => {
  console.error('❌ Failed to initialize database:', err);
});

// === СИСТЕМА ДРУЗЕЙ ===

// Инициализация таблиц для друзей
const initializeFriendsDatabase = async () => {
  try {
    // Таблица для связей друзей
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_referrals (
        id SERIAL PRIMARY KEY,
        referrer_id VARCHAR(50) NOT NULL,
        referred_id VARCHAR(50) NOT NULL,
        referred_name VARCHAR(100),
        reward_coins INTEGER DEFAULT 200,
        claimed BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(referred_id)
      )
    `);

    // Добавляем поля для отслеживания рефералов
    try {
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_by VARCHAR(50)`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_bonus_received BOOLEAN DEFAULT FALSE`);
      console.log('✅ Friends database columns updated');
    } catch (alterErr) {
      console.log('ℹ️ Friends columns already exist or update failed:', alterErr.message);
    }

    console.log('✅ Friends database tables initialized');
  } catch (err) {
    console.error('❌ Error initializing friends database:', err);
  }
};

// Обработка нового пользователя с реферальным кодом
const handleReferralRegistration = async (userId, firstName, referrerId) => {
  try {
    console.log(`👥 Processing referral: ${userId} invited by ${referrerId}`);
    
    // Проверяем, что реферер существует
    const referrerCheck = await pool.query(
      'SELECT user_id FROM users WHERE user_id = $1',
      [referrerId]
    );
    
    if (referrerCheck.rows.length === 0) {
      console.log('❌ Referrer not found:', referrerId);
      return false;
    }
    
    // Создаем запись о реферале
    await pool.query(`
      INSERT INTO user_referrals (referrer_id, referred_id, referred_name)
      VALUES ($1, $2, $3)
      ON CONFLICT (referred_id) DO NOTHING
    `, [referrerId, userId, firstName]);
    
    console.log(`✅ Referral processed: ${userId} gets +100 coins, ${referrerId} gets referral credit`);
    return true;
    
  } catch (err) {
    console.error('❌ Error processing referral:', err);
    return false;
  }
};

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
        SET game_coins = game_coins + $1
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