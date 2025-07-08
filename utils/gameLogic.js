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

// === РАСЧЕТ РЕЗУЛЬТАТА БОЯ ===
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
  cleanupOldResetFlags
};