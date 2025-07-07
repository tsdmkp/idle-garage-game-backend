// config/constants.js - Игровые константы

// === PvP СИСТЕМА - КОНСТАНТЫ ===
const LEAGUES = {
  BRONZE: { 
    name: 'Бронзовая лига', 
    minPower: 0, 
    maxPower: 199,
    entryFee: 25,
    rewards: { win: 40, lose: 15 },
    icon: '🥉',
    color: '#cd7f32'
  },
  SILVER: { 
    name: 'Серебряная лига', 
    minPower: 200, 
    maxPower: 299,
    entryFee: 50,
    rewards: { win: 80, lose: 25 },
    icon: '🥈',
    color: '#c0c0c0'
  },
  GOLD: { 
    name: 'Золотая лига', 
    minPower: 300, 
    maxPower: 399,
    entryFee: 100,
    rewards: { win: 160, lose: 50 },
    icon: '🥇',
    color: '#ffd700'
  },
  PLATINUM: { 
    name: 'Платиновая лига', 
    minPower: 400, 
    maxPower: 999999,
    entryFee: 200,
    rewards: { win: 320, lose: 100 },
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

// === БАЗОВЫЕ ХАРАКТЕРИСТИКИ МАШИН ===
const BASE_CAR_STATS = {
  'car_001': { power: 40, speed: 70, style: 5, reliability: 25 },
  'car_002': { power: 60, speed: 95, style: 10, reliability: 35 },
  'car_003': { power: 75, speed: 110, style: 15, reliability: 45 },
  'car_004': { power: 90, speed: 125, style: 20, reliability: 50 },
  'car_005': { power: 110, speed: 140, style: 30, reliability: 55 },
  'car_006': { power: 130, speed: 160, style: 40, reliability: 60 }
};

// === ИГРОВЫЕ ЛИМИТЫ ===
const GAME_LIMITS = {
  MAX_FUEL: 5,
  FUEL_REFILL_HOURS: 1,
  MAX_OFFLINE_HOURS: 12,
  UPDATE_INTERVAL: 1000,
  
  // PvP лимиты
  MAX_PVP_BATTLES_PER_HOUR: 10,
  
  // Adsgram лимиты
  MAX_ADSGRAM_REWARDS_PER_HOUR: 20
};

// === НАГРАДЫ ===
const REWARDS = {
  NEW_USER_COINS: 500,
  REFERRAL_BONUS_NEW_USER: 100,
  REFERRAL_BONUS_REFERRER: 200,
  
  // Adsgram награды
  ADSGRAM_DEFAULT: 100,
  ADSGRAM_CONSOLATION: 50,
  ADSGRAM_SHOP_HELP: 200
};

module.exports = {
  LEAGUES,
  LEAGUE_POINTS,
  BASE_CAR_STATS,
  GAME_LIMITS,
  REWARDS
};