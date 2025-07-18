// config/constants.js - Игровые константы

// === PvP СИСТЕМА - КОНСТАНТЫ ===

const LEAGUES = {
  BRONZE: { 
    name: 'Бронзовая лига', 
    minPower: 0, 
    maxPower: 149,
    entryFee: 50,
    rewards: { win: 100, lose: 20 },
    icon: '🥉',
    color: '#cd7f32'
  },
  SILVER: { 
    name: 'Серебряная лига', 
    minPower: 150, 
    maxPower: 299,
    entryFee: 100,
    rewards: { win: 200, lose: 40 },
    icon: '🥈',
    color: '#c0c0c0'
  },
  GOLD: { 
    name: 'Золотая лига', 
    minPower: 300, 
    maxPower: 499,
    entryFee: 200,
    rewards: { win: 400, lose: 80 },
    icon: '🥇',
    color: '#ffd700'
  },
  PLATINUM: { 
    name: 'Платиновая лига', 
    minPower: 500, 
    maxPower: 999999,
    entryFee: 500,
    rewards: { win: 1000, lose: 200 },
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
  'car_006': { power: 130, speed: 160, style: 40, reliability: 60 },
  'car_007': { power: 145, speed: 175, style: 48, reliability: 65 },
  'car_008': { power: 160, speed: 195, style: 55, reliability: 70 },
  'car_009': { power: 180, speed: 215, style: 65, reliability: 75 },
  'car_010': { power: 200, speed: 240, style: 75, reliability: 80 },


  'car_077': { power: 150, speed: 180, style: 70, reliability: 80 }

};

// === ИГРОВЫЕ ЛИМИТЫ ===
const GAME_LIMITS = {
  MAX_FUEL: 5,
  FUEL_REFILL_HOURS: 1,
  MAX_OFFLINE_HOURS: 12,
  UPDATE_INTERVAL: 1000,
  
  // PvP лимиты
  MAX_PVP_BATTLES_PER_HOUR: 20,
  
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

// === MILESTONE НАГРАДЫ ЗА РЕФЕРАЛОВ ===
const REFERRAL_MILESTONES = {
  5: {
    reward_coins: 6000,
    reward_type: 'coins',
    title: 'Награда за 5 друзей',
    description: 'Получено за приглашение 5 друзей'
  },
  10: {
    reward_coins: 15000,
    reward_type: 'coins',
    title: 'Награда за 10 друзей',
    description: 'Получено за приглашение 10 друзей'
  },
  25: {
    reward_coins: 40000,
    reward_type: 'coins',
    title: 'Награда за 25 друзей',
    description: 'Получено за приглашение 25 друзей'
  },
  50: {
    reward_coins: 0,
    reward_type: 'car',
    reward_data: {
      car_id: 'car_077',
      car_name: 'Легендарная машина рефера',
      car_stats: { power: 150, speed: 180, style: 70, reliability: 80 }
    },
    title: 'Легендарная машина!',
    description: 'Получено за приглашение 50 друзей'
  }
};

module.exports = {
  LEAGUES,
  LEAGUE_POINTS,
  BASE_CAR_STATS,
  GAME_LIMITS,
  REWARDS,
  REFERRAL_MILESTONES
};