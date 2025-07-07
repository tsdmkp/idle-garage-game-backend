const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();

// === ИМПОРТ МОДУЛЕЙ ===
const { 
  pool,
  initializeDatabase,
  initializeFriendsDatabase,
  initializeAdsgramDatabase,
  gracefulShutdown
} = require('./config/database');

// === ИМПОРТ МАРШРУТОВ ===
const gameRoutes = require('./routes/gameRoutes');
const pvpRoutes = require('./routes/pvpRoutes');

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

// === МАРШРУТЫ ===
app.use('/api', gameRoutes);
app.use('/api/pvp', pvpRoutes);

// === ОСТАВШИЕСЯ СПЕЦИФИЧНЫЕ ЭНДПОИНТЫ ===

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
        rewardCoins = 100;
        rewardType = 'coins';
      } else if (blockIdStr.includes('consolation') || blockIdStr.includes('race')) {
        rewardCoins = 50;
        rewardType = 'coins';
      } else if (blockIdStr.includes('boost') || blockIdStr.includes('income')) {
        rewardCoins = 0;
        rewardType = 'boost';
      } else if (blockIdStr.includes('shop') || blockIdStr.includes('help')) {
        rewardCoins = 200;
        rewardType = 'coins';
      } else if (blockIdStr.includes('fuel') || blockIdStr === '12355') {
        rewardCoins = 0;
        rewardType = 'fuel';
      } else {
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

// ========== GRACEFUL SHUTDOWN ==========
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

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
      console.log(`⚔️ PvP system enabled`);
      console.log(`🔔 Notifications system enabled`);
      console.log(`🎮 Game endpoints: /api/game_state, /api/fuel/*, /api/leaderboard, /api/notifications`);
      console.log(`⚔️ PvP endpoints: /api/pvp/*`);
      console.log(`🤝 Friends endpoints: /api/friends`);
      console.log(`📺 Adsgram endpoints: /api/adsgram/*`);
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