const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();

// === PvP СИСТЕМА - КОНСТАНТЫ ===
// Добавить ПОСЛЕ require('dotenv').config();
// В server.js заменить LEAGUES на более сбалансированные награды:

const LEAGUES = {
  BRONZE: { 
    name: 'Бронзовая лига', 
    minPower: 0, 
    maxPower: 199,
    entryFee: 25,  // ⚖️ СИЛЬНО УМЕНЬШИЛИ
    rewards: { win: 40, lose: 15 },  // ⚖️ СИЛЬНО УМЕНЬШИЛИ
    icon: '🥉',
    color: '#cd7f32'
  },
  SILVER: { 
    name: 'Серебряная лига', 
    minPower: 200, 
    maxPower: 299,
    entryFee: 50,  // ⚖️ СИЛЬНО УМЕНЬШИЛИ  
    rewards: { win: 80, lose: 25 },  // ⚖️ СИЛЬНО УМЕНЬШИЛИ
    icon: '🥈',
    color: '#c0c0c0'
  },
  GOLD: { 
    name: 'Золотая лига', 
    minPower: 300, 
    maxPower: 399,
    entryFee: 100,  // ⚖️ СИЛЬНО УМЕНЬШИЛИ
    rewards: { win: 160, lose: 50 },  // ⚖️ СИЛЬНО УМЕНЬШИЛИ
    icon: '🥇',
    color: '#ffd700'
  },
  PLATINUM: { 
    name: 'Платиновая лига', 
    minPower: 400, 
    maxPower: 999999,
    entryFee: 200,  // ⚖️ СИЛЬНО УМЕНЬШИЛИ
    rewards: { win: 320, lose: 100 },  // ⚖️ СИЛЬНО УМЕНЬШИЛИ
    icon: '💎',
    color: '#e5e4e2'
  }
};



const LEAGUE_POINTS = {
  win: 10,
  lose: -3,
  promotion: 100,
  demotion: -50
};

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
  
  const baseStats = {
    'car_001': { power: 40, speed: 70, style: 5, reliability: 25 },
    'car_002': { power: 60, speed: 95, style: 10, reliability: 35 },
    'car_003': { power: 75, speed: 110, style: 15, reliability: 45 },
    'car_004': { power: 90, speed: 125, style: 20, reliability: 50 },
    'car_005': { power: 110, speed: 140, style: 30, reliability: 55 },
    'car_006': { power: 130, speed: 160, style: 40, reliability: 60 }
  };
  
  const base = baseStats[car.id] || baseStats['car_001'];
  
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


// НАЙТИ в server.js функцию initializeDatabase() и ЗАМЕНИТЬ её на эту:

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
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        invited_by VARCHAR(50),
        referral_bonus_received BOOLEAN DEFAULT FALSE
      )
    `);
    
    // Добавляем недостающие столбцы если их нет
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
    
    // Добавляем комментарии для документации топливных полей
    try {
      await pool.query(`COMMENT ON COLUMN users.fuel_count IS 'Количество топлива для гонок (максимум 5)'`);
      await pool.query(`COMMENT ON COLUMN users.last_race_time IS 'Время последней гонки для расчета восстановления топлива'`);
      await pool.query(`COMMENT ON COLUMN users.fuel_refill_time IS 'Время когда топливо должно восстановиться (null если не нужно)'`);
    } catch (commentErr) {
      console.log('ℹ️ Could not add comments to fuel columns:', commentErr.message);
    }
    
    // Создаем индекс для оптимизации запросов по времени восстановления
    try {
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_users_fuel_refill_time 
        ON users(fuel_refill_time) 
        WHERE fuel_refill_time IS NOT NULL
      `);
    } catch (indexErr) {
      console.log('ℹ️ Could not create fuel index:', indexErr.message);
    }
    
    // Обновляем существующих пользователей (устанавливаем полный бак)
    await pool.query(`UPDATE users SET fuel_count = 5 WHERE fuel_count IS NULL`);
    
    console.log('✅ Database table initialized successfully with fuel system');

    // ========== 🔥 PvP СИСТЕМА ИНИЦИАЛИЗАЦИЯ ==========
    console.log('🏁 Initializing PvP tables...');
    
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
    
    console.log('✅ PvP tables initialized successfully');
    // ========== КОНЕЦ PvP ИНИЦИАЛИЗАЦИИ ==========
    
  } catch (err) {
    console.error('❌ Error initializing database:', err);
  }
};



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

    console.log('✅ Friends database tables initialized');
  } catch (err) {
    console.error('❌ Error initializing friends database:', err);
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

// ========== ADSGRAM ИНТЕГРАЦИЯ ==========

// Инициализация таблицы для логирования Adsgram наград
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

// Обработка корректного завершения работы
const gracefulShutdown = () => {
  console.log('🛑 Received shutdown signal, closing server gracefully...');
  
  // Закрываем пул соединений с базой данных
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