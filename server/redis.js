const Redis = require('ioredis');

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    console.log(`Redis retry attempt ${times}, delay: ${delay}ms`);
    return delay;
  },
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
});

// Track Redis connection status
let isRedisConnected = false;

redis.on('connect', () => {
  console.log('✅ Connected to Redis');
  isRedisConnected = true;
});

redis.on('ready', () => {
  console.log('✅ Redis is ready');
  isRedisConnected = true;
});

redis.on('error', (err) => {
  console.error('❌ Redis error:', err.message);
  isRedisConnected = false;
});

redis.on('close', () => {
  console.log('⚠️ Redis connection closed');
  isRedisConnected = false;
});

redis.on('reconnecting', () => {
  console.log('🔄 Reconnecting to Redis...');
});

// Helper to check if Redis is available
function isRedisAvailable() {
  return isRedisConnected && redis.status === 'ready';
}

// Key prefixes
const KEYS = {
  room: (roomId) => `room:${roomId}`,
  roomMembers: (roomId) => `room:${roomId}:members`,
  roomChat: (roomId) => `room:${roomId}:chat`,
  user: (socketId) => `user:${socketId}`,
  activeRooms: 'active_rooms',
};

// Room TTL in seconds (24 hours)
const ROOM_TTL = 24 * 60 * 60;

module.exports = { redis, KEYS, ROOM_TTL, isRedisAvailable };
