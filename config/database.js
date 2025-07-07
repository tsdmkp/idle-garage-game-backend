// config/database.js - Конфигурация и инициализация базы данных

const { Pool } = require('pg');

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

// ⛽ Функция проверки и восстановления топлива
const checkAndRestoreFuel = (fuelCount, lastRaceTime, fuelRefillTime) => {
  // Валидация входных данных
  const currentFuel = Math.min(Math.max(parseInt(fuelCount) || 5, 0), 5);
  
  if (currentFuel >= 5) {
    return { shouldRestore: false, newFuel: currentFuel };
  }
  
  const now = new Date();
  const FUEL_REFILL_HOUR = 60 * 60 * 1000; // 1 час в миллисекундах
  
  // Определяем время восстановления
  let timeToCheck = null;
  if (fuelRefillTime) {
    timeToCheck = new Date(fuelRefillTime);
  } else if (lastRaceTime) {
    timeToCheck = new Date(new Date(lastRaceTime).getTime() + FUEL_REFILL_HOUR);
  }
  
  // Проверяем, нужно ли восстановить топливо
  if (timeToCheck && now >= timeToCheck) {
    console.log(`⛽ Fuel should be restored. Current: ${currentFuel}, Time check: ${timeToCheck.toISOString()}`);
    return { 
      shouldRestore: true, 
      newFuel: 5,
      newLastRaceTime: now,
      newRefillTime: null 
    };
  }
  
  return { shouldRestore: false, newFuel: currentFuel };
};

// === ОСНОВНАЯ ФУНКЦИЯ ИНИЦИАЛИЗАЦИИ БАЗЫ ДАННЫХ ===
const initializeDatabase = async () => {
  try {
    // 1. СОЗДАНИЕ ОСНОВНОЙ ТАБЛИЦЫ ПОЛЬЗОВАТЕЛЕЙ
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
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        invited_by VARCHAR(50),
        referral_bonus_received BOOLEAN DEFAULT FALSE
      )
    `);
    
    // 2. ДОБАВЛЕНИЕ НЕДОСТАЮЩИХ СТОЛБЦОВ
    try {
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_exit_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS has_completed_tutorial BOOLEAN DEFAULT FALSE`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_by VARCHAR(50)`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_bonus_received BOOLEAN DEFAULT FALSE`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS player_photo TEXT`);
      
      // ⛽ ДОБАВЛЯЕМ ПОЛЯ ТОПЛИВНОЙ СИСТЕМЫ
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS fuel_count INTEGER DEFAULT 5`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_race_time TIMESTAMP`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS fuel_refill_time TIMESTAMP`);
      
      console.log('✅ Database columns updated including fuel system');
    } catch (alterErr) {
      console.log('ℹ️ Database columns already exist or update failed:', alterErr.message);
    }
    
    // 3. ДОБАВЛЕНИЕ КОММЕНТАРИЕВ И ИНДЕКСОВ
    try {
      await pool.query(`COMMENT ON COLUMN users.fuel_count IS 'Количество топлива для гонок (максимум 5)'`);
      await pool.query(`COMMENT ON COLUMN users.last_race_time IS 'Время последней гонки для расчета восстановления топлива'`);
      await pool.query(`COMMENT ON COLUMN users.fuel_refill_time IS 'Время когда топливо должно восстановиться (null если не нужно)'`);
    } catch (commentErr) {
      console.log('ℹ️ Could not add comments to fuel columns:', commentErr.message);
    }
    
    // 4. СОЗДАНИЕ ИНДЕКСА ДЛЯ ТОПЛИВА
    try {
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_users_fuel_refill_time 
        ON users(fuel_refill_time) 
        WHERE fuel_refill_time IS NOT NULL
      `);
    } catch (indexErr) {
      console.log('ℹ️ Could not create fuel index:', indexErr.message);
    }

    // 5. СОЗДАНИЕ ТАБЛИЦЫ УВЕДОМЛЕНИЙ
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS user_notifications (
          id SERIAL PRIMARY KEY,
          user_id TEXT NOT NULL,
          type VARCHAR(50) NOT NULL,
          title VARCHAR(200) NOT NULL,
          message TEXT NOT NULL,
          data JSONB,
          is_read BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);

      // Создаем индекс для быстрого поиска
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON user_notifications(user_id, is_read)`);

      console.log('✅ Notifications table initialized');
    } catch (notificationErr) {
      console.log('ℹ️ Could not create notifications table:', notificationErr.message);
    }
    
    // 6. ОБНОВЛЕНИЕ СУЩЕСТВУЮЩИХ ПОЛЬЗОВАТЕЛЕЙ
    await pool.query(`UPDATE users SET fuel_count = 5 WHERE fuel_count IS NULL`);
    
    console.log('✅ Database table initialized successfully with fuel system');

    // ========== 🔥 PvP СИСТЕМА ИНИЦИАЛИЗАЦИЯ ==========
    console.log('🏁 Initializing PvP tables...');
    
    // 7. ТАБЛИЦЫ PvP СИСТЕМЫ
    await initializePvPTables();
    
    console.log('✅ PvP tables initialized successfully');
    // ========== КОНЕЦ PvP ИНИЦИАЛИЗАЦИИ ==========
    
  } catch (err) {
    console.error('❌ Error initializing database:', err);
    throw err;
  }
};

// === ИНИЦИАЛИЗАЦИЯ PvP ТАБЛИЦ ===
const initializePvPTables = async () => {
  // 1. Таблица лиг игроков
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pvp_leagues (
      user_id TEXT PRIMARY KEY,
      current_league VARCHAR(20) DEFAULT 'BRONZE',
      league_points INTEGER DEFAULT 0,
      wins_today INTEGER DEFAULT 0,
      losses_today INTEGER DEFAULT 0,
      total_wins INTEGER DEFAULT 0,
      total_losses INTEGER DEFAULT 0,
      win_streak INTEGER DEFAULT 0,
      best_win_streak INTEGER DEFAULT 0,
      last_league_update TIMESTAMP DEFAULT NOW(),
      last_battle_date TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // 2. Таблица активных вызовов
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pvp_challenges (
      challenge_id SERIAL PRIMARY KEY,
      from_user_id TEXT NOT NULL,
      to_user_id TEXT NOT NULL,
      league VARCHAR(20) NOT NULL,
      entry_fee INTEGER NOT NULL,
      from_car_power INTEGER NOT NULL,
      to_car_power INTEGER,
      message TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '24 hours',
      status VARCHAR(20) DEFAULT 'pending',
      responded_at TIMESTAMP,
      completed_at TIMESTAMP
    )
  `);

  // 3. Таблица завершенных матчей
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pvp_matches (
      match_id SERIAL PRIMARY KEY,
      challenge_id INTEGER REFERENCES pvp_challenges(challenge_id),
      attacker_id TEXT NOT NULL,
      defender_id TEXT NOT NULL,
      league VARCHAR(20) NOT NULL,
      attacker_car_power INTEGER NOT NULL,
      defender_car_power INTEGER NOT NULL,
      attacker_car_name VARCHAR(100),
      defender_car_name VARCHAR(100),
      winner TEXT NOT NULL,
      attacker_reward INTEGER NOT NULL,
      defender_reward INTEGER NOT NULL,
      attacker_score DECIMAL(10,2),
      defender_score DECIMAL(10,2),
      battle_details JSONB,
      match_date TIMESTAMP DEFAULT NOW(),
      season_week INTEGER DEFAULT EXTRACT(WEEK FROM NOW())
    )
  `);

  // 4. Таблица ботов
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pvp_bots (
      bot_id SERIAL PRIMARY KEY,
      bot_name VARCHAR(50) NOT NULL,
      car_name VARCHAR(100) NOT NULL,
      car_power INTEGER NOT NULL,
      league VARCHAR(20) NOT NULL,
      wins INTEGER DEFAULT 0,
      losses INTEGER DEFAULT 0,
      last_online TIMESTAMP DEFAULT NOW(),
      personality_type VARCHAR(20) DEFAULT 'normal',
      response_delay_min INTEGER DEFAULT 5,
      response_delay_max INTEGER DEFAULT 120,
      accept_rate DECIMAL(3,2) DEFAULT 0.85,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // 5. Создаем индексы для оптимизации
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pvp_leagues_league ON pvp_leagues(current_league)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pvp_challenges_to_user ON pvp_challenges(to_user_id, status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pvp_challenges_from_user ON pvp_challenges(from_user_id, status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pvp_bots_league_power ON pvp_bots(league, car_power)`);
  
  // 6. Проверяем есть ли боты, если нет - создаем
  const botsCount = await pool.query('SELECT COUNT(*) as count FROM pvp_bots');
  if (parseInt(botsCount.rows[0].count) === 0) {
    console.log('🤖 Creating initial PvP bots...');
    await pool.query(`
      INSERT INTO pvp_bots (bot_name, car_name, car_power, league, wins, losses, personality_type, accept_rate) VALUES
      ('Дмитрий_Новичок', 'Ржавая "Копейка"', 145, 'BRONZE', 15, 8, 'defensive', 0.95),
      ('Сергей_Учится', 'Ржавая "Копейка"', 155, 'BRONZE', 22, 12, 'normal', 0.85),
      ('Андрей_Гонщик', 'Бодрая "Девятка"', 175, 'BRONZE', 31, 19, 'aggressive', 0.75),
      ('Михаил_Драйв', 'Бодрая "Девятка"', 190, 'BRONZE', 28, 15, 'normal', 0.80),
      ('Алексей_Про', 'Старый "Японец"', 220, 'SILVER', 45, 23, 'normal', 0.82),
      ('Денис_Форсаж', 'Старый "Японец"', 240, 'SILVER', 52, 28, 'aggressive', 0.78),
      ('Игорь_Скорость', 'Старый "Японец"', 260, 'SILVER', 38, 22, 'defensive', 0.88),
      ('Роман_Турбо', 'Старый "Японец"', 285, 'SILVER', 41, 25, 'normal', 0.84),
      ('Владимир_Мастер', 'Легендарный "Мерс"', 320, 'GOLD', 67, 31, 'aggressive', 0.76),
      ('Евгений_Легенда', 'Легендарный "Мерс"', 340, 'GOLD', 71, 29, 'normal', 0.81),
      ('Николай_Король', 'Легендарный "Мерс"', 365, 'GOLD', 58, 35, 'defensive', 0.87),
      ('Виктор_Чемпион', 'Легендарный "Мерс"', 385, 'GOLD', 64, 33, 'normal', 0.83),
      ('Александр_Бог', 'Заряженный "Баварец"', 420, 'PLATINUM', 89, 21, 'aggressive', 0.73),
      ('Максим_Титан', 'Заряженный "Баварец"', 460, 'PLATINUM', 94, 18, 'normal', 0.79),
      ('Павел_Император', 'Безумный "Скайлайн"', 520, 'PLATINUM', 78, 26, 'defensive', 0.85),
      ('Дмитрий_Всевышний', 'Безумный "Скайлайн"', 580, 'PLATINUM', 103, 15, 'aggressive', 0.71)
    `);
    
    // Обновляем время онлайн ботов
    await pool.query(`UPDATE pvp_bots SET last_online = NOW() - (RANDOM() * INTERVAL '2 hours')`);
    console.log('✅ PvP bots created successfully');
  }
};

// === ИНИЦИАЛИЗАЦИЯ ДРУЗЕЙ И ADSGRAM ===
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

    console.log('✅ Friends database tables initialized');
  } catch (err) {
    console.error('❌ Error initializing friends database:', err);
  }
};

const initializeAdsgramDatabase = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS adsgram_rewards (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        block_id VARCHAR(255),
        reward_coins INTEGER DEFAULT 0,
        reward_type VARCHAR(50) DEFAULT 'coins',
        ip_address INET,
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Создаем индексы для оптимизации
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_adsgram_rewards_user_time ON adsgram_rewards(user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_adsgram_rewards_block ON adsgram_rewards(block_id, created_at);
    `);
    
    console.log('✅ Adsgram database table initialized');
  } catch (err) {
    console.error('❌ Error initializing Adsgram database:', err);
  }
};

// === GRACEFUL SHUTDOWN ===
const gracefulShutdown = () => {
  console.log('🛑 Received shutdown signal, closing database pool gracefully...');
  
  pool.end(() => {
    console.log('📊 Database pool has ended');
    process.exit(0);
  });
  
  // Принудительно завершаем процесс через 10 секунд
  setTimeout(() => {
    console.log('⏰ Forcefully shutting down');
    process.exit(1);
  }, 10000);
};

// Экспортируем все необходимые функции
module.exports = {
  pool,
  checkAndRestoreFuel,
  initializeDatabase,
  initializeFriendsDatabase,
  initializeAdsgramDatabase,
  gracefulShutdown
};