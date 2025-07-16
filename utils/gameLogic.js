// utils/gameLogic.js - Игровая логика и расчеты + 🆕 СИСТЕМА РЕПУТАЦИИ

const { LEAGUES, LEAGUE_POINTS, BASE_CAR_STATS } = require('../config/constants');
const { pool } = require('../config/database');

// 🆕 === ОБНОВЛЕННАЯ СИСТЕМА РЕПУТАЦИИ ELITE-STYLE ===
const REPUTATION_RANKS = {
  ROOKIE: {
    name: 'Новичок',
    icon: '🟢',
    minWins: 0,
    maxWins: 100,
    color: '#22c55e',
    description: 'Только начинает свой путь'
  },
  DRIVER: {
    name: 'Водитель', 
    icon: '🔵',
    minWins: 101,
    maxWins: 250,
    color: '#3b82f6',
    description: 'Освоил базовые навыки'
  },
  RACER: {
    name: 'Гонщик',
    icon: '🟡', 
    minWins: 251,
    maxWins: 500,
    color: '#eab308',
    description: 'Серьезный соперник'
  },
  PRO: {
    name: 'Профи',
    icon: '🟠',
    minWins: 501,
    maxWins: 1000,
    color: '#f97316',
    description: 'Опытный пилот'
  },
  ACE: {
    name: 'Ас',
    icon: '🔴',
    minWins: 1001,
    maxWins: 2000,
    color: '#ef4444',
    description: 'Мастер автоспорта'
  },
  MASTER: {
    name: 'Мастер',
    icon: '🟣',
    minWins: 2001,
    maxWins: 3500,
    color: '#8b5cf6',
    description: 'Виртуоз за рулем'
  },
  LEGEND: {
    name: 'Легенда',
    icon: '⚫',
    minWins: 3501,
    maxWins: 6500,
    color: '#6b7280',
    description: 'Живая легенда трассы'
  },
  CHAMPION: {
    name: 'Чемпион',
    icon: '💎',
    minWins: 6501,
    maxWins: 10000,
    color: '#06b6d4',
    description: 'Непобедимый чемпион'
  },
  ELITE: {
    name: 'Элита',
    icon: '👑',
    minWins: 10001,
    maxWins: Infinity,
    color: '#ffd700',
    description: 'Элита автоспорта'
  }
};

// 🆕 === ФУНКЦИЯ ОПРЕДЕЛЕНИЯ РАНГА ПО ПОБЕДАМ ===
function getReputationRank(totalWins) {
  // Валидация входного параметра
  const wins = Math.max(0, parseInt(totalWins) || 0);
  
  // Ищем подходящий ранг
  for (const [rankKey, rankData] of Object.entries(REPUTATION_RANKS)) {
    if (wins >= rankData.minWins && wins <= rankData.maxWins) {
      return {
        key: rankKey,
        name: rankData.name,
        icon: rankData.icon,
        color: rankData.color,
        description: rankData.description,
        currentWins: wins,
        nextRankWins: rankData.maxWins === Infinity ? null : rankData.maxWins + 1,
        progressPercent: rankData.maxWins === Infinity ? 100 : 
          Math.round(((wins - rankData.minWins) / (rankData.maxWins - rankData.minWins)) * 100)
      };
    }
  }
  
  // Fallback на новичка
  return {
    key: 'ROOKIE',
    name: 'Новичок',
    icon: '🟢',
    color: '#22c55e',
    description: 'Только начинает свой путь',
    currentWins: wins,
    nextRankWins: 101,
    progressPercent: Math.min(100, Math.round((wins / 100) * 100))
  };
}

// 🆕 === ФУНКЦИЯ СРАВНЕНИЯ РАНГОВ ===
function compareReputationRanks(rank1, rank2) {
  const ranks = Object.keys(REPUTATION_RANKS);
  const index1 = ranks.indexOf(rank1.key);
  const index2 = ranks.indexOf(rank2.key);
  
  if (index1 > index2) return 1;   // rank1 выше
  if (index1 < index2) return -1;  // rank2 выше
  return 0;                        // равны
}

// 🆕 === ФУНКЦИЯ ПОЛУЧЕНИЯ ВСЕХ РАНГОВ (ДЛЯ UI) ===
function getAllReputationRanks() {
  return Object.entries(REPUTATION_RANKS).map(([key, data]) => ({
    key,
    ...data
  }));
}

// 🆕 === ФУНКЦИЯ ФОРМАТИРОВАНИЯ РАНГА ДЛЯ ОТОБРАЖЕНИЯ ===
function formatReputationRank(rank, showProgress = false) {
  if (!rank) return '🟢 Новичок';
  
  let result = `${rank.icon} ${rank.name}`;
  
  if (showProgress && rank.nextRankWins) {
    const winsNeeded = rank.nextRankWins - rank.currentWins;
    result += ` (${winsNeeded} до следующего)`;
  }
  
  return result;
}

// === ОПРЕДЕЛЕНИЕ ЛИГИ ПО МОЩНОСТИ (СТАРАЯ СИСТЕМА) ===
function getLeagueByPower(carPower) {
  for (const [key, league] of Object.entries(LEAGUES)) {
    if (carPower >= league.minPower && carPower <= league.maxPower) {
      return key;
    }
  }
  return 'BRONZE';
}

// === РАСЧЕТ МОЩНОСТИ МАШИНЫ (СТАРАЯ СИСТЕМА) ===
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

// === 🆕 НОВАЯ ДЕТАЛЬНАЯ СИСТЕМА РАСЧЕТА ===
function calculateDetailedCarScore(car) {
  if (!car || !car.parts) return { total: 0, breakdown: { power: 0, speed: 0, style: 0, reliability: 0 } };
  
  const base = BASE_CAR_STATS[car.id] || BASE_CAR_STATS['car_001'];
  
  const power = base.power + ((car.parts.engine?.level || 0) * 5);
  const speed = base.speed + ((car.parts.tires?.level || 0) * 3);
  const style = base.style + ((car.parts.style_body?.level || 0) * 4);
  const reliability = base.reliability + ((car.parts.reliability_base?.level || 0) * 5);
  
  return {
    total: power + speed + style + reliability,
    breakdown: { power, speed, style, reliability }
  };
}

// === 🆕 РАСЧЕТ ШАНСОВ СОБЫТИЙ ===
function calculateEventChances(carParts, baseCar) {
  const engineLevel = carParts?.engine?.level || 0;
  const tiresLevel = carParts?.tires?.level || 0;
  const styleLevel = carParts?.style_body?.level || 0;
  const reliabilityLevel = carParts?.reliability_base?.level || 0;
  
  // Итоговые параметры = база + тюнинг
  const totalPower = baseCar.power + (engineLevel * 5);
  const totalSpeed = baseCar.speed + (tiresLevel * 3);
  const totalStyle = baseCar.style + (styleLevel * 4);
  const totalReliability = baseCar.reliability + (reliabilityLevel * 5);
  
  return {
    // Power события (0-30% шанс)
    powerBoost: Math.min(0.3, totalPower / 350),
    powerLack: Math.max(0, (80 - totalPower) / 400),
    
    // Speed события (0-35% шанс)
    perfectStart: Math.min(0.35, totalSpeed / 400),
    slowReaction: Math.max(0, (100 - totalSpeed) / 500),
    
    // Style события (0-40% шанс)
    perfectTurn: Math.min(0.4, totalStyle / 100),
    crash: Math.max(0.05, (60 - totalStyle) / 200),
    
    // Reliability события (0-35% шанс)
    systemsOk: Math.min(0.35, totalReliability / 150),
    breakdown: Math.max(0.02, (80 - totalReliability) / 300)
  };
}

// === 🆕 ГЕНЕРАЦИЯ СОБЫТИЙ ДЛЯ УЧАСТНИКА ===
function generateParticipantEvents(chances) {
  const events = {};
  
  // Power события
  if (Math.random() < chances.powerBoost) {
    events.powerEvent = Math.random() < 0.5 ? 'powerRush' : 'motorRoar';
  } else if (Math.random() < chances.powerLack) {
    events.powerEvent = 'weakEngine';
  }
  
  // Speed события
  if (Math.random() < chances.perfectStart) {
    events.speedEvent = Math.random() < 0.6 ? 'perfectStart' : 'quickReaction';
  } else if (Math.random() < chances.slowReaction) {
    events.speedEvent = 'slowStart';
  }
  
  // Style события
  if (Math.random() < chances.perfectTurn) {
    events.styleEvent = Math.random() < 0.7 ? 'perfectTurn' : 'masterControl';
  } else if (Math.random() < chances.crash) {
    events.styleEvent = Math.random() < 0.6 ? 'crash' : 'loseControl';
  }
  
  // Reliability события
  if (Math.random() < chances.systemsOk) {
    events.reliabilityEvent = Math.random() < 0.5 ? 'perfectEngine' : 'systemsOk';
  } else if (Math.random() < chances.breakdown) {
    events.reliabilityEvent = Math.random() < 0.4 ? 'techProblem' : 'overheating';
  }
  
  return events;
}

// === 🆕 ПРИМЕНЕНИЕ ЭФФЕКТОВ СОБЫТИЙ ===
function applyEventEffects(baseScore, events) {
  let finalScore = baseScore;
  let appliedEvents = [];
  
  // Power события
  if (events.powerEvent === 'powerRush') {
    finalScore *= 1.25;
    appliedEvents.push({ type: 'power_boost', multiplier: 1.25 });
  } else if (events.powerEvent === 'motorRoar') {
    finalScore *= 1.20;
    appliedEvents.push({ type: 'power_boost', multiplier: 1.20 });
  } else if (events.powerEvent === 'weakEngine') {
    finalScore *= 0.85;
    appliedEvents.push({ type: 'power_lack', multiplier: 0.85 });
  }
  
  // Speed события
  if (events.speedEvent === 'perfectStart') {
    finalScore *= 1.40;
    appliedEvents.push({ type: 'speed_boost', multiplier: 1.40 });
  } else if (events.speedEvent === 'quickReaction') {
    finalScore *= 1.20;
    appliedEvents.push({ type: 'speed_boost', multiplier: 1.20 });
  } else if (events.speedEvent === 'slowStart') {
    finalScore *= 0.75;
    appliedEvents.push({ type: 'speed_lack', multiplier: 0.75 });
  }
  
  // Style события
  if (events.styleEvent === 'perfectTurn') {
    finalScore *= 1.20;
    appliedEvents.push({ type: 'style_boost', multiplier: 1.20 });
  } else if (events.styleEvent === 'masterControl') {
    finalScore *= 1.25;
    appliedEvents.push({ type: 'style_boost', multiplier: 1.25 });
  } else if (events.styleEvent === 'crash') {
    finalScore *= 0.60;
    appliedEvents.push({ type: 'style_fail', multiplier: 0.60 });
  } else if (events.styleEvent === 'loseControl') {
    finalScore *= 0.70;
    appliedEvents.push({ type: 'style_fail', multiplier: 0.70 });
  }
  
  // Reliability события
  if (events.reliabilityEvent === 'perfectEngine') {
    finalScore *= 1.20;
    appliedEvents.push({ type: 'reliability_boost', multiplier: 1.20 });
  } else if (events.reliabilityEvent === 'systemsOk') {
    finalScore *= 1.15;
    appliedEvents.push({ type: 'reliability_boost', multiplier: 1.15 });
  } else if (events.reliabilityEvent === 'techProblem') {
    finalScore *= 0.75;
    appliedEvents.push({ type: 'reliability_fail', multiplier: 0.75 });
  } else if (events.reliabilityEvent === 'overheating') {
    finalScore *= 0.70;
    appliedEvents.push({ type: 'reliability_fail', multiplier: 0.70 });
  }
  
  return {
    finalScore: Math.round(finalScore),
    appliedEvents
  };
}

// === 🆕 СОЗДАНИЕ СОБЫТИЙ ДЛЯ UI ===
function createRaceEventsFromResults(racer1Events, racer2Events) {
  const events = [];
  
  // Функция для добавления событий участника
  const addParticipantEvents = (participantEvents, participant) => {
    // Power события
    if (participantEvents.powerEvent === 'powerRush') {
      events.push({
        type: `${participant}_power_boost`,
        text: participant === 'player' ? '🚀 **Турбо-ускорение!**' : '🚀 Соперник: **Турбо-ускорение!**',
        time: 1500 + Math.random() * 1000,
        participant
      });
    } else if (participantEvents.powerEvent === 'motorRoar') {
      events.push({
        type: `${participant}_power_boost`,
        text: participant === 'player' ? '⚡ **Рев двигателя на пределе!**' : '⚡ Соперник: **Рев двигателя на пределе!**',
        time: 2000 + Math.random() * 1000,
        participant
      });
    } else if (participantEvents.powerEvent === 'weakEngine') {
      events.push({
        type: `${participant}_power_fail`,
        text: participant === 'player' ? '😴 **Двигатель сбоит...**' : '😴 Соперник: **Двигатель сбоит...**',
        time: 2500 + Math.random() * 1000,
        participant
      });
    }
    
    // Speed события
    if (participantEvents.speedEvent === 'perfectStart') {
      events.push({
        type: `${participant}_speed_boost`,
        text: participant === 'player' ? '🚀 **Идеальный старт!**' : '🚀 Соперник: **Идеальный старт!**',
        time: 800 + Math.random() * 400,
        participant
      });
    } else if (participantEvents.speedEvent === 'quickReaction') {
      events.push({
        type: `${participant}_speed_boost`,
        text: participant === 'player' ? '⚡ **Мгновенный рывок!**' : '⚡ Соперник: **Мгновенный рывок!**',
        time: 1200 + Math.random() * 500,
        participant
      });
    } else if (participantEvents.speedEvent === 'slowStart') {
      events.push({
        type: `${participant}_speed_fail`,
        text: participant === 'player' ? '🐢 **Заглох на старте...**' : '🐢 Соперник: **Заглох на старте...**',
        time: 1000 + Math.random() * 500,
        participant
      });
    }
    
    // Style события
    if (participantEvents.styleEvent === 'perfectTurn') {
      events.push({
        type: `${participant}_style_boost`,
        text: participant === 'player' ? '🏁 **Мастерский дрифт!**' : '🏁 Соперник: **Мастерский дрифт!**',
        time: 3000 + Math.random() * 1000,
        participant
      });
    } else if (participantEvents.styleEvent === 'masterControl') {
      events.push({
        type: `${participant}_style_boost`,
        text: participant === 'player' ? '🌟 **Безупречный контроль!**' : '🌟 Соперник: **Безупречный контроль!**',
        time: 3500 + Math.random() * 1000,
        participant
      });
    } else if (participantEvents.styleEvent === 'crash') {
      events.push({
        type: `${participant}_style_fail`,
        text: participant === 'player' ? '💥 **Критический занос!**' : '💥 Соперника **занесло!**',
        time: 3200 + Math.random() * 800,
        participant
      });
    } else if (participantEvents.styleEvent === 'loseControl') {
      events.push({
        type: `${participant}_style_fail`,
        text: participant === 'player' ? '🌀 **Потерял управление!**' : '🌀 Соперник **потерял управление!**',
        time: 3800 + Math.random() * 700,
        participant
      });
    }
    
    // Reliability события
    if (participantEvents.reliabilityEvent === 'perfectEngine') {
      events.push({
        type: `${participant}_reliability_boost`,
        text: participant === 'player' ? '🍀 **Идеальная работа двигателя!**' : '🍀 Соперник: **Идеальная работа двигателя!**',
        time: 4000 + Math.random() * 1000,
        participant
      });
    } else if (participantEvents.reliabilityEvent === 'systemsOk') {
      events.push({
        type: `${participant}_reliability_boost`,
        text: participant === 'player' ? '⚙️ **Все системы в норме!**' : '⚙️ Соперник: **Все системы в норме!**',
        time: 4200 + Math.random() * 800,
        participant
      });
    } else if (participantEvents.reliabilityEvent === 'techProblem') {
      events.push({
        type: `${participant}_reliability_fail`,
        text: participant === 'player' ? '⚙️ **Техническая неисправность!**' : '⚙️ У соперника **неисправность!**',
        time: 4500 + Math.random() * 1000,
        participant
      });
    } else if (participantEvents.reliabilityEvent === 'overheating') {
      events.push({
        type: `${participant}_reliability_fail`,
        text: participant === 'player' ? '🔥 **Критический перегрев!**' : '🔥 Мотор соперника **перегрелся!**',
        time: 4800 + Math.random() * 700,
        participant
      });
    }
  };
  
  addParticipantEvents(racer1Events, 'player');
  addParticipantEvents(racer2Events, 'opponent');
  
  // Сортируем события по времени
  return events.sort((a, b) => a.time - b.time);
}

// === 🔥 ГЛАВНАЯ ФУНКЦИЯ: НОВЫЙ РАСЧЕТ РЕЗУЛЬТАТА ГОНКИ ===
function calculateBattleResult(attackerCar, defenderCar) {
  console.log('🏁 Начинаем гонку с новой системой событий:', {
    racer1: attackerCar.name,
    racer2: defenderCar.name
  });

  // Получаем базовые характеристики машин
  const attackerBase = BASE_CAR_STATS[attackerCar.id] || BASE_CAR_STATS['car_001'];
  const defenderBase = BASE_CAR_STATS[defenderCar.id] || BASE_CAR_STATS['car_001'];
  
  // Рассчитываем детальные характеристики
  const attackerStats = calculateDetailedCarScore(attackerCar);
  const defenderStats = calculateDetailedCarScore(defenderCar);
  
  console.log('📊 Характеристики участников:', {
    attacker: attackerStats,
    defender: defenderStats
  });
  
  // Рассчитываем шансы на события
  const attackerChances = calculateEventChances(attackerCar.parts || {}, attackerBase);
  const defenderChances = calculateEventChances(defenderCar.parts || {}, defenderBase);
  
  console.log('🎲 Шансы на события:', {
    attackerChances,
    defenderChances
  });
  
  // Генерируем события для каждого участника
  const attackerEvents = generateParticipantEvents(attackerChances);
  const defenderEvents = generateParticipantEvents(defenderChances);
  
  console.log('🎭 Сгенерированные события:', {
    attackerEvents,
    defenderEvents
  });
  
  // Применяем события к базовым характеристикам
  const attackerResult = applyEventEffects(attackerStats.total, attackerEvents);
  const defenderResult = applyEventEffects(defenderStats.total, defenderEvents);
  
  console.log('⚡ Результаты после событий:', {
    attacker: attackerResult,
    defender: defenderResult
  });
  
  // Добавляем небольшой элемент случайности (±10%)
  const randomFactor1 = 0.9 + Math.random() * 0.2; // 0.9 - 1.1
  const randomFactor2 = 0.9 + Math.random() * 0.2; // 0.9 - 1.1
  
  const finalAttackerScore = Math.round(attackerResult.finalScore * randomFactor1);
  const finalDefenderScore = Math.round(defenderResult.finalScore * randomFactor2);
  
  // Определяем победителя
  const attackerWins = finalAttackerScore > finalDefenderScore;
  const winner = attackerWins ? 'attacker' : 'defender';
  
  // Создаем события для UI
  const raceEvents = createRaceEventsFromResults(attackerEvents, defenderEvents);
  
  console.log('🏆 Финальный результат:', {
    winner,
    attackerScore: finalAttackerScore,
    defenderScore: finalDefenderScore,
    eventsCount: raceEvents.length
  });
  
  // Создаем детальный отчет о гонке
  const raceReport = {
    racer1: {
      basePower: attackerStats.total,
      breakdown: attackerStats.breakdown,
      events: attackerEvents,
      appliedEffects: attackerResult.appliedEvents,
      finalScore: finalAttackerScore
    },
    racer2: {
      basePower: defenderStats.total,
      breakdown: defenderStats.breakdown,
      events: defenderEvents,
      appliedEffects: defenderResult.appliedEvents,
      finalScore: finalDefenderScore
    },
    winner: attackerWins ? 'racer1' : 'racer2',
    events: raceEvents
  };

  // Возвращаем в совместимом формате
  return {
    winner,
    attackerScore: finalAttackerScore,
    defenderScore: finalDefenderScore,
    margin: Math.abs(finalAttackerScore - finalDefenderScore),
    attackerHadLuck: attackerResult.appliedEvents.some(e => e.multiplier > 1),
    defenderHadLuck: defenderResult.appliedEvents.some(e => e.multiplier > 1),
    raceReport
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
  // Старые функции (для совместимости)
  getLeagueByPower,
  calculateCarScore,
  calculateDetailedCarScore,
  calculateBattleResult,
  updatePvPStats,
  formatNumber,
  isValidCar,
  calculateFuelRefillTime,
  checkPvPBattleLimit,
  cleanupOldResetFlags,
  getRaceDescription,
  
  // Новые функции событий
  calculateEventChances,
  generateParticipantEvents,
  applyEventEffects,
  createRaceEventsFromResults,
  
  // 🆕 НОВЫЕ ФУНКЦИИ РЕПУТАЦИИ
  getReputationRank,
  compareReputationRanks,
  getAllReputationRanks,
  formatReputationRank,
  REPUTATION_RANKS // Экспортируем константы для использования в других модулях
};