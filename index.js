require('dotenv').config();
console.log('DATABASE_URL:', process.env.DATABASE_URL);
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

// Инициализация Express
const app = express();
app.use(express.json());
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH'],
    allowedHeaders: ['Content-Type', 'X-Telegram-Init-Data'],
    credentials: true
}));

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
                    defaultData.buildings,
                    defaultData.hired_staff,
                    defaultData.player_cars,
                    defaultData.selected_car_id,
                    defaultData.income_rate_per_hour
                ]
            );
            userData = defaultData;
            console.log('Inserted default data:', userData);
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

        // Улучшенная нормализация JSON
        const normalizeJson = (data) => {
            if (data === undefined || data === null) {
                console.warn('Data is undefined/null, returning null');
                return null;
            }
            if (typeof data === 'string') {
                try {
                    const cleanedData = data
                        .replace(/\\"/g, '"') // Удаляем экранирование кавычек
                        .replace(/\\+/g, '\\') // Корректируем обратные слэши
                        .replace(/}\s*}/g, '}'); // Удаляем лишние закрывающие скобки
                    return JSON.parse(cleanedData);
                } catch (e) {
                    console.error('Failed to parse JSON:', data, e);
                    throw new Error(`Invalid JSON format: ${data}`);
                }
            }
            return JSON.parse(JSON.stringify(data)); // Гарантируем валидный JSON
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
            income_rate_per_hour: parseInt(updates.income_rate_per_hour) || userData.income_rate_per_hour // Преобразуем в число
        };

        console.log('Updating with:', JSON.stringify(updatedData, null, 2));

        await pool.query(
            'UPDATE users SET player_level = $1, first_name = $2, game_coins = $3, jet_coins = $4, current_xp = $5, xp_to_next_level = $6, last_collected_time = $7, buildings = $8, hired_staff = $9, player_cars = $10, selected_car_id = $11, income_rate_per_hour = $12 WHERE user_id = $13',
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
                updatedData.income_rate_per_hour,
                userId
            ]
        );

        console.log(`Updated user state for ${userId}:`, JSON.stringify(updatedData, null, 2));
        res.json(updatedData);
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