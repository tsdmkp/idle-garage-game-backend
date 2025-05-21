require('dotenv').config(); // Для загрузки переменных окружения из .env

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
// Render предоставляет свой порт через process.env.PORT
const port = process.env.PORT || 3000; 

// --- НАСТРОЙКА CORS ---
// Важно: на продакшене лучше указывать конкретные домены фронтенда.
// Пока оставляем '*' как вы просили, но имейте в виду, это небезопасно для реальных приложений.
app.use(cors({
  origin: '*', 
  methods: ['GET', 'POST', 'PUT', 'PATCH'], // Убедитесь, что все необходимые методы здесь
  allowedHeaders: ['Content-Type', 'X-Telegram-Init-Data'], // Убедитесь, что заголовки, которые отправляет фронтенд, разрешены
  credentials: true // Важно, если используете куки или сессии
}));

// Middleware для парсинга JSON-тела запросов
app.use(express.json());

// --- НАСТРОЙКА PostgreSQL ---
// Проверка переменных окружения (для отладки)
console.log('Environment variables:');
console.log('DB_USER:', process.env.DB_USER);
console.log('DB_HOST:', process.env.DB_HOST);
console.log('DB_NAME:', process.env.DB_NAME);
console.log('DB_PORT:', process.env.DB_PORT);
console.log('DB_PASSWORD:', process.env.DB_PASSWORD ? '[hidden]' : 'undefined');
console.log('DATABASE_URL:', process.env.DATABASE_URL ? '[hidden]' : 'undefined');

// Выбираем способ подключения к БД.
// Приоритет отдаем DATABASE_URL, так как Render обычно предоставляет его.
// Если DATABASE_URL нет, используем отдельные переменные (user, host и т.д.)
const dbConfig = process.env.DATABASE_URL ? 
  { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } } :
  {
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT || 5432,
    ssl: { rejectUnauthorized: false } // Требуется для Render
  };

const pool = new Pool(dbConfig);

// Проверка подключения к базе данных при старте
pool.connect()
  .then(() => console.log('Successfully connected to database'))
  .catch(err => console.error('Failed to connect to database:', err.message));

// --- МАРШРУТЫ API ---

// Маршрут для получения состояния игры
app.get('/game_state', async (req, res) => {
  const userId = req.query.userId; // user_id обязателен
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE user_id = $1', [userId]);
    let userData = result.rows[0];

    if (!userData) {
      console.log(`No user found for ${userId}, creating default data`);
      // Создаем нового пользователя с дефолтными данными
      const defaultData = {
        user_id: userId,
        player_level: 1,
        first_name: req.query.first_name || 'Игрок', // Получаем имя из запроса, если есть
        game_coins: 100,
        jet_coins: 0,
        current_xp: 0,
        xp_to_next_level: 100,
        income_rate_per_hour: 25, // Начальный доход
        last_collected_time: Date.now(),
        buildings: JSON.stringify([{ name: 'garage', level: 1, isLocked: false }, { name: 'workshop', level: 0, isLocked: false }, { name: 'office', level: 0, isLocked: true }]),
        hired_staff: JSON.stringify({ 'mechanic': 0 }),
        player_cars: JSON.stringify([{
            id: 'basic-car',
            name: 'Basic Car',
            imageUrl: 'https://via.placeholder.com/150',
            parts: {
                engine: { level: 1, name: 'Двигатель', type: 'engine' },
                wheels: { level: 1, name: 'Колеса', type: 'wheels' },
                exhaust: { level: 1, name: 'Выхлоп', type: 'exhaust' },
            },
            stats: { speed: 10, acceleration: 5, handling: 8, incomeBonus: 0 }
        }]),
        selected_car_id: 'basic-car'
      };

      await pool.query(
        `INSERT INTO users (user_id, player_level, first_name, game_coins, jet_coins, current_xp, xp_to_next_level, income_rate_per_hour, last_collected_time, buildings, hired_staff, player_cars, selected_car_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb, $13)`,
        [
          defaultData.user_id, defaultData.player_level, defaultData.first_name,
          defaultData.game_coins, defaultData.jet_coins, defaultData.current_xp,
          defaultData.xp_to_next_level, defaultData.income_rate_per_hour,
          defaultData.last_collected_time, defaultData.buildings, defaultData.hired_staff,
          defaultData.player_cars, defaultData.selected_car_id
        ]
      );
      userData = defaultData; // Возвращаем созданные данные
    } else {
      // Парсим JSONB поля
      userData.buildings = typeof userData.buildings === 'string' ? JSON.parse(userData.buildings) : userData.buildings;
      userData.hired_staff = typeof userData.hired_staff === 'string' ? JSON.parse(userData.hired_staff) : userData.hired_staff;
      userData.player_cars = typeof userData.player_cars === 'string' ? JSON.parse(userData.player_cars) : userData.player_cars;
    }

    res.json(userData);
  } catch (error) {
    console.error('Error fetching game state:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// Маршрут для сохранения состояния игры
app.post('/game_state', async (req, res) => {
  const userId = req.body.userId;
  const updates = req.body; // Все данные, которые пришли с фронтенда

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  try {
    // Получаем текущее состояние пользователя, чтобы объединить данные
    const result = await pool.query('SELECT * FROM users WHERE user_id = $1', [userId]);
    let userData = result.rows[0];

    if (!userData) {
      // Если пользователя нет, создаем его с переданными данными (если они полные)
      console.log(`User ${userId} not found during save, creating new entry.`);
      const newUserData = {
        user_id: userId,
        player_level: updates.player_level || 1,
        first_name: updates.first_name || 'Игрок',
        game_coins: updates.game_coins || 100,
        jet_coins: updates.jet_coins || 0,
        current_xp: updates.current_xp || 0,
        xp_to_next_level: updates.xp_to_next_level || 100,
        income_rate_per_hour: updates.income_rate_per_hour || 25,
        last_collected_time: updates.last_collected_time || Date.now(),
        buildings: updates.buildings ? JSON.stringify(updates.buildings) : JSON.stringify([{ name: 'garage', level: 1, isLocked: false }]),
        hired_staff: updates.hired_staff ? JSON.stringify(updates.hired_staff) : JSON.stringify({ 'mechanic': 0 }),
        player_cars: updates.player_cars ? JSON.stringify(updates.player_cars) : JSON.stringify([{ id: 'basic-car' }]),
        selected_car_id: updates.selected_car_id || 'basic-car'
      };

      await pool.query(
        `INSERT INTO users (user_id, player_level, first_name, game_coins, jet_coins, current_xp, xp_to_next_level, income_rate_per_hour, last_collected_time, buildings, hired_staff, player_cars, selected_car_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb, $13)`,
        [
          newUserData.user_id, newUserData.player_level, newUserData.first_name,
          newUserData.game_coins, newUserData.jet_coins, newUserData.current_xp,
          newUserData.xp_to_next_level, newUserData.income_rate_per_hour,
          newUserData.last_collected_time, newUserData.buildings, newUserData.hired_staff,
          newUserData.player_cars, newUserData.selected_car_id
        ]
      );
    } else {
      // Пользователь найден, обновляем его данные
      // Объединяем полученные обновления с текущими данными из БД
      const updatedData = {
        player_level: updates.player_level !== undefined ? updates.player_level : userData.player_level,
        game_coins: updates.game_coins !== undefined ? updates.game_coins : userData.game_coins,
        jet_coins: updates.jet_coins !== undefined ? updates.jet_coins : userData.jet_coins,
        current_xp: updates.current_xp !== undefined ? updates.current_xp : userData.current_xp,
        xp_to_next_level: updates.xp_to_next_level !== undefined ? updates.xp_to_next_level : userData.xp_to_next_level,
        income_rate_per_hour: updates.income_rate_per_hour !== undefined ? updates.income_rate_per_hour : userData.income_rate_per_hour,
        last_collected_time: updates.last_collected_time !== undefined ? updates.last_collected_time : userData.last_collected_time,
        buildings: updates.buildings !== undefined ? JSON.stringify(updates.buildings) : userData.buildings, // JSONB
        hired_staff: updates.hired_staff !== undefined ? JSON.stringify(updates.hired_staff) : userData.hired_staff, // JSONB
        player_cars: updates.player_cars !== undefined ? JSON.stringify(updates.player_cars) : userData.player_cars, // JSONB
        selected_car_id: updates.selected_car_id !== undefined ? updates.selected_car_id : userData.selected_car_id,
        first_name: updates.first_name !== undefined ? updates.first_name : userData.first_name
      };

      await pool.query(
        'UPDATE users SET player_level = $1, first_name = $2, game_coins = $3, jet_coins = $4, current_xp = $5, xp_to_next_level = $6, last_collected_time = $7, buildings = $8::jsonb, hired_staff = $9::jsonb, player_cars = $10::jsonb, selected_car_id = $11 WHERE user_id = $12',
        [
          updatedData.player_level,
          updatedData.first_name,
          updatedData.game_coins,
          updatedData.jet_coins,
          updatedData.current_xp,
          updatedData.xp_to_next_level,
          updatedData.last_collected_time,
          updatedData.buildings,
          updatedData.hired_staff,
          updatedData.player_cars,
          updatedData.selected_car_id,
          userId
        ]
      );
    }
    console.log(`Game state saved for userId: ${userId}`);
    res.status(200).json({ message: 'Game state saved successfully' });
  } catch (error) {
    console.error('Error saving game state:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Маршрут для получения таблицы рекордов
app.get('/leaderboard', async (req, res) => {
  const userId = req.query.userId; // user_id текущего игрока, чтобы показать его место

  try {
    // Проверка, существует ли колонка income_rate_per_hour
    const columnCheck = await pool.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'income_rate_per_hour'
    `);
    if (columnCheck.rows.length === 0) {
      console.error('Column income_rate_per_hour does not exist in users table');
      // В случае отсутствия колонки, возвращаем пустые данные или дефолт
      return res.json({ topPlayers: [], currentPlayer: null, message: 'Missing income_rate_per_hour column in DB' });
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

    res.json({
      topPlayers: topPlayersResult.rows,
      currentPlayer: currentPlayer
    });

  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Запуск сервера
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});