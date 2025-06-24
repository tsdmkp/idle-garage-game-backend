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
        game_coins BIGINT DEFAULT 100000,
        jet_coins INTEGER DEFAULT 0,
        current_xp INTEGER DEFAULT 10,
        xp_to_next_level INTEGER DEFAULT 100,
        last_collected_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        buildings JSONB DEFAULT '[]',
        player_cars JSONB DEFAULT '[]',
        selected_car_id VARCHAR(50),
        hired_staff JSONB DEFAULT '{}',
        income_rate_per_hour INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Database table initialized successfully');
  } catch (err) {
    console.error('Error initializing database:', err);
  }
};

// Эндпоинт для получения состояния игры
app.get('/api/game_state', async (req, res) => {
  const userId = req.query.userId || 'default';
  
  try {
    const result = await pool.query('SELECT * FROM users WHERE user_id = $1', [userId]);
    
    if (result.rows.length === 0) {
      // Создаем нового пользователя
      const insertResult = await pool.query(`
        INSERT INTO users (user_id, first_name, username, player_level, game_coins, jet_coins, current_xp, xp_to_next_level, buildings, player_cars, hired_staff)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *
      `, [
        userId,
        'Игрок',
        null,
        1,
        100000,
        0,
        10,
        100,
        JSON.stringify([]),
        JSON.stringify([]),
        JSON.stringify({})
      ]);
      
      res.status(200).json(insertResult.rows[0]);
    } else {
      res.status(200).json(result.rows[0]);
    }
  } catch (err) {
    console.error('Error fetching game state:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Эндпоинт для обновления состояния игры
app.post('/api/game_state', async (req, res) => {
  const { userId, ...updateData } = req.body;
  const finalUserId = userId || 'default';
  
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
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('Error updating game state:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Эндпоинт для таблицы рекордов
app.get('/leaderboard', async (req, res) => {
  const userId = req.query.userId || 'default';

  try {
    // Проверяем, существует ли столбец income_rate_per_hour
    const columnCheck = await pool.query(`
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'income_rate_per_hour'
    `);
    if (columnCheck.rows.length === 0) {
      console.error('Column income_rate_per_hour does not exist in users table');
      return res.status(500).json({ error: 'Database schema error: missing income_rate_per_hour column' });
    }

    // Получаем топ-10 игроков
    const topPlayersResult = await pool.query(
      'SELECT user_id, first_name, income_rate_per_hour FROM users WHERE income_rate_per_hour IS NOT NULL ORDER BY income_rate_per_hour DESC LIMIT 10'
    );

    // Получаем место текущего игрока
    let currentPlayer = null;
    if (userId) {
      const rankResult = await pool.query(
        `SELECT user_id, first_name, income_rate_per_hour, (
           SELECT COUNT(*) + 1
           FROM users u2
           WHERE u2.income_rate_per_hour > u1.income_rate_per_hour
         ) as rank
         FROM users u1
         WHERE u1.user_id = $1 AND u1.income_rate_per_hour IS NOT NULL`,
        [userId]
      );
      if (rankResult.rows.length > 0) {
        currentPlayer = rankResult.rows[0];
      }
    }

    res.status(200).json({
      top_players: topPlayersResult.rows,
      current_player: currentPlayer
    });

  } catch (err) {
    console.error('Error fetching leaderboard:', err);
    res.status(500).json({ error: 'Failed to fetch leaderboard data' });
  }
});

// Инициализируем базу данных и запускаем сервер
initializeDatabase().then(() => {
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
});