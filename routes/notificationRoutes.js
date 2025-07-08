// routes/notificationRoutes.js - API эндпоинты для уведомлений

const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');

// GET /api/notifications - Получить непрочитанные уведомления
router.get('/', async (req, res) => {
  try {
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Не указан пользователь' 
      });
    }

    console.log('🔔 Получение уведомлений для пользователя:', userId);

    // Получаем только непрочитанные уведомления
    const notifications = await pool.query(`
      SELECT 
        id,
        type,
        title,
        message,
        data,
        created_at,
        is_read
      FROM user_notifications 
      WHERE user_id = $1 
        AND is_read = false
      ORDER BY created_at DESC
      LIMIT 50
    `, [userId]);

    console.log(`✅ Найдено ${notifications.rows.length} непрочитанных уведомлений`);

    res.json({
      success: true,
      notifications: notifications.rows
    });

  } catch (error) {
    console.error('❌ Ошибка получения уведомлений:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Внутренняя ошибка сервера' 
    });
  }
});

// POST /api/notifications/mark-read - Отметить уведомления как прочитанные
router.post('/mark-read', async (req, res) => {
  try {
    const { userId, notificationIds } = req.body;
    
    if (!userId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Не указан пользователь' 
      });
    }

    console.log('✅ Отметка уведомлений как прочитанные:', { userId, notificationIds });

    let result;
    
    if (notificationIds && Array.isArray(notificationIds) && notificationIds.length > 0) {
      // Отмечаем конкретные уведомления
      result = await pool.query(`
        UPDATE user_notifications 
        SET is_read = true, updated_at = NOW()
        WHERE user_id = $1 
          AND id = ANY($2::int[])
          AND is_read = false
        RETURNING id
      `, [userId, notificationIds]);
    } else {
      // Отмечаем все непрочитанные уведомления пользователя
      result = await pool.query(`
        UPDATE user_notifications 
        SET is_read = true, updated_at = NOW()
        WHERE user_id = $1 
          AND is_read = false
        RETURNING id
      `, [userId]);
    }

    console.log(`✅ Отмечено ${result.rowCount} уведомлений как прочитанные`);

    res.json({
      success: true,
      message: `Отмечено ${result.rowCount} уведомлений как прочитанные`,
      markedCount: result.rowCount
    });

  } catch (error) {
    console.error('❌ Ошибка отметки уведомлений:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Внутренняя ошибка сервера' 
    });
  }
});

// GET /api/notifications/history - История всех уведомлений (для отладки)
router.get('/history', async (req, res) => {
  try {
    const { userId } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    if (!userId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Не указан пользователь' 
      });
    }

    // Получаем все уведомления с пагинацией
    const notifications = await pool.query(`
      SELECT 
        id,
        type,
        title,
        message,
        data,
        created_at,
        is_read
      FROM user_notifications 
      WHERE user_id = $1 
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `, [userId, limit, offset]);

    // Считаем общее количество
    const totalCount = await pool.query(`
      SELECT COUNT(*) as count 
      FROM user_notifications 
      WHERE user_id = $1
    `, [userId]);

    res.json({
      success: true,
      notifications: notifications.rows,
      pagination: {
        page,
        limit,
        total: parseInt(totalCount.rows[0]?.count || 0),
        totalPages: Math.ceil((totalCount.rows[0]?.count || 0) / limit)
      }
    });

  } catch (error) {
    console.error('❌ Ошибка получения истории уведомлений:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Внутренняя ошибка сервера' 
    });
  }
});

// DELETE /api/notifications/clear - Очистить все уведомления пользователя
router.delete('/clear', async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Не указан пользователь' 
      });
    }

    console.log('🗑️ Очистка всех уведомлений для пользователя:', userId);

    const result = await pool.query(`
      DELETE FROM user_notifications 
      WHERE user_id = $1
      RETURNING id
    `, [userId]);

    console.log(`🗑️ Удалено ${result.rowCount} уведомлений`);

    res.json({
      success: true,
      message: `Удалено ${result.rowCount} уведомлений`,
      deletedCount: result.rowCount
    });

  } catch (error) {
    console.error('❌ Ошибка очистки уведомлений:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Внутренняя ошибка сервера' 
    });
  }
});

module.exports = router;