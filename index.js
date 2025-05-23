require('dotenv').config();
  console.log('DATABASE_URL:', process.env.DATABASE_URL);
  const express = require('express');
  const cors = require('cors');
  const { Pool } = require('pg');

  const app = express();
  app.use(express.json());
  app.use(cors({
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'PATCH'],
      allowedHeaders: ['Content-Type', 'X-Telegram-Init-Data'],
      credentials: true
  }));

  // Добавляем middleware для отладки входящих запросов
  app.use((req, res, next) => {
      console.log(`[${new Date().toISOString()}] Received request: ${req.method} ${req.url}`);
      console.log('Headers:', req.headers);
      next();
  });

  const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
  });

  pool.connect()
      .then(() => console.log('Connected to PostgreSQL'))
      .catch(err => console.error('Failed to connect to PostgreSQL:', err));

  app.get('/game_state', async (req, res) => {
      const userId = req.query.userId || 'default';
      try {
          console.log('Fetching game state for userId:', userId);
          const result = await pool.query('SELECT * FROM users WHERE user_id = $1', [userId]);
          console.log('Query result:', result.rows);
          let userData = result.rows[0];

          if (!userData) {
              console.log('No user found, creating default data');
              const defaultData = {
                  user_id: userId,
                  player_level: 1,
                  first_name: 'Игрок',
                  game_coins: 1000,
                  jet_coins: 0,
                  current_xp: 10,
                  xp_to_next_level: 100,
                  last_collected_time: Date.now(),
                  buildings: [
                      { id: 'wash', name: 'Автомойка', level: 1, icon: '🧼', isLocked: false },
                      { id: 'service', name: 'Сервис', level: 0, icon: '🔧', isLocked: false },
                      { id: 'tires', name: 'Шиномонтаж', level: 0, icon: '🔘', isLocked: true },
                      { id: 'drift', name: 'Шк. Дрифта', level: 0, icon: '🏫', isLocked: true }
                  ],
                  hired_staff: { mechanic: 0, manager: 0 },
                  player_cars: [
                      {
                          id: 'car_001',
                          name: 'Ржавая "Копейка"',
                          imageUrl: '/placeholder-car.png',
                          parts: {
                              engine: { level: 1, name: 'Двигатель' },
                              tires: { level: 0, name: 'Шины' },
                              style_body: { level: 0, name: 'Кузов (Стиль)' },
                              reliability_base: { level: 1, name: 'Надежность (База)' }
                          },
                          stats: {
                              power: 45,
                              speed: 70,
                              style: 5,
                              reliability: 30
                          }
                      }
                  ],
                  selected_car_id: 'car_001',
                  income_rate_per_hour: 25
              };
              await pool.query(
                  'INSERT INTO users (user_id, player_level, first_name, game_coins, jet_coins, current_xp, xp_to_next_level, last_collected_time, buildings, hired_staff, player_cars, selected_car_id, income_rate_per_hour) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)',
                  [
                      defaultData.user_id,
                      defaultData.player_level,
                      defaultData.first_name,
                      defaultData.game_coins,
                      defaultData.jet_coins,
                      defaultData.current_xp,
                      defaultData.xp_to_next_level,
                      defaultData.last_collected_time,
                      JSON.stringify(defaultData.buildings),
                      JSON.stringify(defaultData.hired_staff),
                      JSON.stringify(defaultData.player_cars),
                      defaultData.selected_car_id,
                      defaultData.income_rate_per_hour
                  ]
              );
              userData = defaultData;
              console.log('Inserted default data:', userData);
          } else {
              if (typeof userData.buildings === 'string') {
                  userData.buildings = JSON.parse(userData.buildings);
              }
              if (typeof userData.hired_staff === 'string') {
                  userData.hired_staff = JSON.parse(userData.hired_staff);
              }
              if (typeof userData.player_cars === 'string') {
                  userData.player_cars = JSON.parse(userData.player_cars);
              }

              const now = Date.now();
              const lastCollected = parseInt(userData.last_collected_time) || now;
              const timeDiffMs = now - lastCollected;
              const incomePerMs = userData.income_rate_per_hour / (1000 * 60 * 60);
              const offlineIncome = Math.floor(timeDiffMs * incomePerMs);
              console.log(`Offline income calculation: timeDiffMs=${timeDiffMs}, incomePerMs=${incomePerMs}, offlineIncome=${offlineIncome}`);
              if (offlineIncome > 0) {
                  userData.game_coins += offlineIncome;
                  userData.last_collected_time = now;
                  await pool.query(
                      'UPDATE users SET game_coins = $1, last_collected_time = $2 WHERE user_id = $3',
                      [userData.game_coins, userData.last_collected_time, userId]
                  );
                  console.log(`Added offline income: ${offlineIncome} coins, new game_coins: ${userData.game_coins}`);
              }
          }
          res.json(userData);
      } catch (err) {
          console.error('Error fetching game state:', err);
          res.status(500).json({ message: 'Server error', error: err.message });
      }
  });

  app.patch('/game_state', async (req, res) => {
      const userId = req.body.userId || req.query.userId || 'default';
      const updates = req.body;
      try {
          console.log('Updating game state for userId:', userId);
          console.log('Received updates:', JSON.stringify(updates, null, 2));
          const result = await pool.query('SELECT * FROM users WHERE user_id = $1', [userId]);
          const userData = result.rows[0];

          if (!userData) {
              return res.status(404).json({ message: 'User not found' });
          }

          if (typeof userData.buildings === 'string') {
              userData.buildings = JSON.parse(userData.buildings);
          }
          if (typeof userData.hired_staff === 'string') {
              userData.hired_staff = JSON.parse(userData.hired_staff);
          }
          if (typeof userData.player_cars === 'string') {
              userData.player_cars = JSON.parse(userData.player_cars);
          }

          const normalizeJson = (data) => {
              if (data === undefined || data === null) {
                  console.warn('Data is undefined/null, returning null');
                  return null;
              }
              if (typeof data === 'string') {
                  try {
                      return JSON.parse(data);
                  } catch (e) {
                      console.error('Failed to parse JSON string:', data, e);
                      return null;
                  }
              }
              return data;
          };

          const updatedData = {
              ...userData,
              ...updates,
              buildings: normalizeJson(updates.buildings) || userData.buildings,
              player_cars: normalizeJson(updates.player_cars) || userData.player_cars,
              hired_staff: normalizeJson(updates.hired_staff) || userData.hired_staff,
              selected_car_id: updates.selected_car_id || userData.selected_car_id,
              last_collected_time: updates.last_collected_time || userData.last_collected_time,
              first_name: updates.first_name || userData.first_name,
              income_rate_per_hour: parseInt(updates.income_rate_per_hour) || userData.income_rate_per_hour
          };

          const safeUpdateData = {
              ...updatedData,
              buildings: JSON.stringify(updatedData.buildings),
              player_cars: JSON.stringify(updatedData.player_cars),
              hired_staff: JSON.stringify(updatedData.hired_staff)
          };

          console.log('Updating with:', JSON.stringify(safeUpdateData, null, 2));

          await pool.query(
              'UPDATE users SET player_level = $1, first_name = $2, game_coins = $3, jet_coins = $4, current_xp = $5, xp_to_next_level = $6, last_collected_time = $7, buildings = $8, hired_staff = $9, player_cars = $10, selected_car_id = $11, income_rate_per_hour = $12 WHERE user_id = $13',
              [
                  safeUpdateData.player_level,
                  safeUpdateData.first_name,
                  safeUpdateData.game_coins,
                  safeUpdateData.jet_coins,
                  safeUpdateData.current_xp,
                  safeUpdateData.xp_to_next_level,
                  safeUpdateData.last_collected_time,
                  safeUpdateData.buildings,
                  safeUpdateData.hired_staff,
                  safeUpdateData.player_cars,
                  safeUpdateData.selected_car_id,
                  safeUpdateData.income_rate_per_hour,
                  userId
              ]
          );

          if (typeof safeUpdateData.buildings === 'string') {
              safeUpdateData.buildings = JSON.parse(safeUpdateData.buildings);
          }
          if (typeof safeUpdateData.hired_staff === 'string') {
              safeUpdateData.hired_staff = JSON.parse(safeUpdateData.hired_staff);
          }
          if (typeof safeUpdateData.player_cars === 'string') {
              safeUpdateData.player_cars = JSON.parse(safeUpdateData.player_cars);
          }

          console.log(`Updated user state for ${userId}:`, JSON.stringify(safeUpdateData, null, 2));
          res.json(safeUpdateData);
      } catch (err) {
          console.error('Error updating game state:', err.message);
          console.error('Stack trace:', err.stack);
          res.status(500).json({ message: 'Server error', error: err.message });
      }
  });

  app.get('/leaderboard', async (req, res) => {
      const userId = req.query.userId || 'default';
      try {
          console.log('Fetching leaderboard for userId:', userId);
          const result = await pool.query('SELECT user_id, first_name, game_coins, current_xp FROM users ORDER BY game_coins DESC LIMIT 10');
          console.log('Leaderboard result:', result.rows);
          res.json(result.rows);
      } catch (err) {
          console.error('Error fetching leaderboard:', err);
          res.status(500).json({ message: 'Server error', error: err.message });
      }
  });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));