// utils/gameLogic.js - Игровая логика и расчеты

const { LEAGUES, LEAGUE_POINTS, BASE_CAR_STATS } = require('../config/constants');
const { pool } = require('../config/database');

// === ОПРЕДЕЛЕНИЕ ЛИГИ ПО МОЩНОСТИ ===
function getLeagueByPower(carPower) {
  for (const [key, league] of Object.entries(LEAGUES)) {
    if (carPower >= league.minPower && carPower <= league.maxPower) {
      return key;
    }
  }
  return 'BRONZE';
}

// === РАСЧЕТ МОЩНОСТИ МАШИНЫ ===
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

// ✅ НОВАЯ ФУНКЦИЯ: Создание событий гонки НА СЕРВЕРЕ
function createRaceEvents(racer1Events, racer2Events) {
  const events = [];
  
  // События игрока (racer1)
  if (racer1Events.perfectStart) {
    events.push({ 
      type: 'player_perfect', 
      text: '🚀 Идеальный старт!', 
      time: 1000,
      participant: 'player'
    });
  }
  
  if (racer1Events.crash) {
    events.push({ 
      type: 'player_crash', 
      text: '💥 Занос на повороте!', 
      time: 4000,
      participant: 'player'
    });
  }
  
  if (racer1Events.lucky) {
    events.push({ 
      type: 'player_lucky', 
      text: '🍀 Попутный ветер!', 
      time: 2500,
      participant: 'player'
    });
  }
  
  // События соперника (racer2)
  if (racer2Events.perfectStart) {
    events.push({ 
      type: 'opponent_perfect', 
      text: '🚀 Соперник: идеальный старт!', 
      time: 1200,
      participant: 'opponent'
    });
  }
  
  if (racer2Events.crash) {
    events.push({ 
      type: 'opponent_crash', 
      text: '💥 Соперника занесло!', 
      time: 4500,
      participant: 'opponent'
    });
  }
  
  if (racer2Events.lucky) {
    events.push({ 
      type: 'opponent_lucky', 
      text: '🍀 Сопернику повезло!', 
      time: 3000,
      participant: 'opponent'
    });
  }
  
  // Сортируем события по времени
  return events.sort((a, b) => a.time - b.time);
}

// === РАСЧЕТ РЕЗУЛЬТАТА ГОНКИ ===
function calculateBattleResult(attackerCar, defenderCar) {
  console.log('🏁 Начинаем гонку:', {
    racer1: attackerCar.name,
    racer1Power: attackerCar.power,
    racer2: defenderCar.name,
    racer2Power: defenderCar.power
  });

  // НОВЫЙ УСИЛЕННЫЙ RNG - разброс ±40% вместо ±20%
  const racer1Multiplier = Math.random() * 0.8 + 0.6; // 0.6 - 1.4 (было 0.8-1.2)
  const racer2Multiplier = Math.random() * 0.8 + 0.6; // 0.6 - 1.4 (было 0.8-1.2)

  console.log('🎲 Условия гонки:', {
    racer1: racer1Multiplier.toFixed(2),
    racer2: racer2Multiplier.toFixed(2)
  });

  // ✅ ОДИНАКОВЫЕ ШАНСЫ ДЛЯ ВСЕХ (независимо от роли, бот/игрок)
  const racer1Lucky = Math.random() < 0.2;         // 20% шанс везения
  const racer2Lucky = Math.random() < 0.2;         // 20% шанс везения (одинаковый!)

  console.log('🍀 Удачные моменты:', {
    racer1Lucky,
    racer2Lucky
  });

  // ✅ ОДИНАКОВЫЕ ШАНСЫ НА СОБЫТИЯ ДЛЯ ВСЕХ
  const racer1PerfectStart = Math.random() < 0.05; // 5% шанс на идеальный старт
  const racer1Crash = Math.random() < 0.05;        // 5% шанс на занос
  const racer2PerfectStart = Math.random() < 0.05; // 5% шанс на идеальный старт (одинаковый!)
  const racer2Crash = Math.random() < 0.05;        // 5% шанс на занос (одинаковый!)

  console.log('🏎️ Гоночные события:', {
    racer1PerfectStart,
    racer1Crash,
    racer2PerfectStart,
    racer2Crash
  });

  // Используем функцию calculateCarScore для получения мощности
  const attackerBasePower = calculateCarScore(attackerCar);
  const defenderBasePower = calculateCarScore(defenderCar);

  // Базовые результаты
  let racer1Score = attackerBasePower * racer1Multiplier;
  let racer2Score = defenderBasePower * racer2Multiplier;

  // Применяем удачу (попутный ветер +30%)
  if (racer1Lucky) {
    racer1Score *= 1.3;
    console.log('🍀 Первый гонщик поймал попутный ветер! +30%');
  }
  
  if (racer2Lucky) {
    racer2Score *= 1.3;
    console.log('🍀 Второй гонщик поймал попутный ветер! +30%');
  }

  // НОВАЯ ЛОГИКА: Применяем гоночные события
  if (racer1PerfectStart && !racer1Crash) {
    racer1Score *= 2.0; // Идеальный старт x2
    console.log('🚀 Идеальный старт первого гонщика! x2 скорость');
  } else if (racer1Crash) {
    racer1Score *= 0.5; // Занос -50%
    console.log('💥 Первый гонщик занесло на повороте! -50% скорость');
  }

  if (racer2PerfectStart && !racer2Crash) {
    racer2Score *= 2.0; // Идеальный старт x2
    console.log('🚀 Идеальный старт второго гонщика! x2 скорость');
  } else if (racer2Crash) {
    racer2Score *= 0.5; // Занос -50%
    console.log('💥 Второго гонщика занесло на повороте! -50% скорость');
  }

  // Округляем итоговые очки
  racer1Score = Math.round(racer1Score);
  racer2Score = Math.round(racer2Score);

  // Определяем победителя (сохраняем совместимость с существующим кодом)
  const attackerWins = racer1Score > racer2Score;
  const winner = attackerWins ? 'attacker' : 'defender';
  
  console.log('🏁 Результат гонки:', {
    racer1FinalScore: racer1Score,
    racer2FinalScore: racer2Score,
    winner: attackerWins ? 'racer1' : 'racer2'
  });

  // ✅ СОЗДАЕМ СОБЫТИЯ ГОНКИ НА СЕРВЕРЕ
  const raceEvents = createRaceEvents(
    {
      perfectStart: racer1PerfectStart,
      crash: racer1Crash,
      lucky: racer1Lucky
    },
    {
      perfectStart: racer2PerfectStart,
      crash: racer2Crash,
      lucky: racer2Lucky
    }
  );

  console.log('📋 События гонки созданы на сервере:', raceEvents);

  // Создаем детальный отчет о гонке
  const raceReport = {
    racer1: {
      basePower: attackerBasePower,
      multiplier: racer1Multiplier.toFixed(2),
      lucky: racer1Lucky,
      perfectStart: racer1PerfectStart,
      crash: racer1Crash,
      finalScore: racer1Score
    },
    racer2: {
      basePower: defenderBasePower,
      multiplier: racer2Multiplier.toFixed(2),
      lucky: racer2Lucky,
      perfectStart: racer2PerfectStart,
      crash: racer2Crash,
      finalScore: racer2Score
    },
    winner: attackerWins ? 'racer1' : 'racer2',
    events: raceEvents // ✅ ДОБАВЛЯЕМ ГОТОВЫЕ СОБЫТИЯ
  };

  console.log('📊 Детальный отчет о гонке с событиями:', raceReport);

  // Возвращаем в том же формате, что ожидает остальной код
  return {
    winner,
    attackerScore: racer1Score,
    defenderScore: racer2Score,
    margin: Math.abs(racer1Score - racer2Score),
    attackerHadLuck: racer1Lucky || racer1PerfectStart,
    defenderHadLuck: racer2Lucky || racer2PerfectStart,
    raceReport // Добавляем детальный отчет с событиями
  };
}

// === ОБНОВЛЕНИЕ СТАТИСТИКИ PvP ===
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
    
    console.log(`📊 PvP stats updated for ${userId}: ${isWin ? 'WIN' : 'LOSS'} (+${pointsChange} points)`);
    
  } catch (error) {
    console.error('❌ Ошибка обновления статистики PvP:', error);
    throw error;
  }
}

// === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===

// Форматирование чисел для отображения
function formatNumber(num) {
  const number = typeof num === 'string' ? parseInt(num) || 0 : num;
  
  if (number >= 1000000) {
    return (number / 1000000).toFixed(1) + 'M';
  } else if (number >= 1000) {
    return (number / 1000).toFixed(1) + 'K';
  }
  return number.toString();
}

// Проверка валидности машины
function isValidCar(car) {
  return car && 
         car.id && 
         car.name && 
         car.parts && 
         typeof car.parts === 'object';
}

// Расчет времени до восстановления топлива
function calculateFuelRefillTime(lastRaceTime, hoursToRefill = 1) {
  if (!lastRaceTime) return null;
  
  const lastRace = new Date(lastRaceTime);
  const refillTime = new Date(lastRace.getTime() + (hoursToRefill * 60 * 60 * 1000));
  
  return refillTime;
}

// 🔧 ИСПРАВЛЕННАЯ ФУНКЦИЯ: Проверка лимитов PvP боев (с учетом сброса через рекламу)
async function checkPvPBattleLimit(userId, maxBattlesPerHour = 10) {
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    // 🔧 ИСПРАВЛЕНО: Учитываем сброс лимита через рекламу
    const recentBattles = await pool.query(`
      SELECT COUNT(*) as count 
      FROM pvp_matches 
      WHERE (attacker_id = $1 OR defender_id = $1)
      AND match_date > $2
      AND (
        battle_details IS NULL 
        OR battle_details->>'limit_reset' IS NULL 
        OR battle_details->>'limit_reset' != 'true'
      )
    `, [userId, oneHourAgo]);

    const battleCount = parseInt(recentBattles.rows[0]?.count) || 0;
    
    console.log(`🔍 PvP Limit Check for ${userId}:`, {
      battleCount,
      maxAllowed: maxBattlesPerHour,
      canBattle: battleCount < maxBattlesPerHour,
      timeWindow: `${oneHourAgo.toISOString()} - ${new Date().toISOString()}`
    });
    
    return {
      canBattle: battleCount < maxBattlesPerHour,
      currentCount: battleCount,
      maxAllowed: maxBattlesPerHour,
      timeToReset: new Date(Date.now() + (60 * 60 * 1000)) // через час
    };
  } catch (error) {
    console.error('❌ Error checking PvP battle limit:', error);
    return { canBattle: true, currentCount: 0, maxAllowed: maxBattlesPerHour };
  }
}

// 🆕 ФУНКЦИЯ АВТОМАТИЧЕСКОЙ ОЧИСТКИ СТАРЫХ ФЛАГОВ
async function cleanupOldResetFlags() {
  try {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    
    const result = await pool.query(`
      UPDATE pvp_matches 
      SET battle_details = battle_details - 'limit_reset' - 'reset_time'
      WHERE match_date < $1 
        AND battle_details ? 'limit_reset'
      RETURNING match_id
    `, [twoHoursAgo]);
    
    if (result.rowCount > 0) {
      console.log(`🧹 Очищено ${result.rowCount} старых флагов сброса лимита`);
    }
    
  } catch (error) {
    console.error('❌ Ошибка очистки старых флагов:', error);
  }
}

// ✅ НОВАЯ ФУНКЦИЯ: Получить описание гонки (если понадобится для уведомлений)
function getRaceDescription(raceReport) {
  const { racer1, racer2, winner, events } = raceReport;
  
  let description = [];
  
  // Добавляем описания событий
  if (events && events.length > 0) {
    events.forEach(event => {
      description.push(event.text);
    });
  }
  
  // Итоговый результат
  const winnerName = winner === 'racer1' ? 'Вы' : 'Соперник';
  description.push(`🏁 ${winnerName} финишируете первым! Счет: ${
    winner === 'racer1' ? 
    `${racer1.finalScore} - ${racer2.finalScore}` :
    `${racer2.finalScore} - ${racer1.finalScore}`
  }`);
  
  return description.join(' ');
}

// Экспорт всех функций
module.exports = {
  getLeagueByPower,
  calculateCarScore,
  calculateBattleResult,
  updatePvPStats,
  formatNumber,
  isValidCar,
  calculateFuelRefillTime,
  checkPvPBattleLimit,
  cleanupOldResetFlags,
  getRaceDescription,
  createRaceEvents // ✅ Экспортируем новую функцию
};