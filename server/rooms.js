const { redis, KEYS, ROOM_TTL, isRedisAvailable } = require('./redis');

const MAX_ROOM_MEMBERS = 5;

// In-memory fallback store when Redis is unavailable
const memoryStore = {
  rooms: new Map(),
  members: new Map(),
  users: new Map(),
  chat: new Map(),
};

/**
 * Create a new room
 * @param {string} roomId 
 * @param {string|null} password 
 * @returns {Promise<{success: boolean, error?: string, hasPassword?: boolean, startTime?: number}>}
 */
async function createRoom(roomId, password = null) {
  const startTime = Date.now();
  const roomData = {
    password: password || '',
    hasPassword: password ? '1' : '0',
    startTime: startTime.toString(),
    createdAt: new Date().toISOString(),
  };

  if (!isRedisAvailable()) {
    // Fallback to memory
    if (memoryStore.rooms.has(roomId)) {
      return { success: false, error: 'Room already exists' };
    }
    memoryStore.rooms.set(roomId, roomData);
    console.log(`⚠️ Room ${roomId} created in memory (Redis unavailable)`);
    return { success: true, hasPassword: !!password, startTime };
  }

  const roomKey = KEYS.room(roomId);
  
  // Check if room already exists
  const exists = await redis.exists(roomKey);
  if (exists) {
    return { success: false, error: 'Room already exists' };
  }
  
  // Create room hash
  await redis.hset(roomKey, roomData);
  
  // Set TTL for room
  await redis.expire(roomKey, ROOM_TTL);
  
  // Add to active rooms set
  await redis.sadd(KEYS.activeRooms, roomId);
  
  return { success: true, hasPassword: !!password, startTime };
}

/**
 * Check if room exists and its properties
 * @param {string} roomId 
 * @returns {Promise<{exists: boolean, hasPassword?: boolean, userCount?: number, startTime?: number}>}
 */
async function checkRoom(roomId) {
  if (!isRedisAvailable()) {
    // Fallback to memory
    const roomData = memoryStore.rooms.get(roomId);
    if (!roomData) {
      return { exists: false };
    }
    const members = memoryStore.members.get(roomId) || new Map();
    return {
      exists: true,
      hasPassword: roomData.hasPassword === '1',
      userCount: members.size,
      isFull: members.size >= MAX_ROOM_MEMBERS,
      startTime: parseInt(roomData.startTime, 10),
    };
  }

  const roomKey = KEYS.room(roomId);
  const membersKey = KEYS.roomMembers(roomId);
  
  const roomData = await redis.hgetall(roomKey);
  
  if (!roomData || Object.keys(roomData).length === 0) {
    return { exists: false };
  }
  
  const userCount = await redis.hlen(membersKey);
  
  return {
    exists: true,
    hasPassword: roomData.hasPassword === '1',
    userCount,
    isFull: userCount >= MAX_ROOM_MEMBERS,
    startTime: parseInt(roomData.startTime, 10),
  };
}

/**
 * Join a room
 * @param {string} roomId 
 * @param {string} socketId 
 * @param {string|null} password 
 * @param {string|null} displayName 
 * @returns {Promise<{success: boolean, error?: string, requiresPassword?: boolean, users?: Array, currentUser?: object, startTime?: number}>}
 */
async function joinRoom(roomId, socketId, password = null, displayName = null) {
  const userDisplayName = displayName || `User-${socketId.slice(0, 6)}`;
  const currentUser = { id: socketId, displayName: userDisplayName };

  if (!isRedisAvailable()) {
    // Fallback to memory
    const roomData = memoryStore.rooms.get(roomId);
    if (!roomData) {
      return { success: false, error: 'Room does not exist' };
    }

    if (roomData.hasPassword === '1' && roomData.password !== password) {
      return { success: false, error: 'Invalid password', requiresPassword: true };
    }

    let members = memoryStore.members.get(roomId);
    if (!members) {
      members = new Map();
      memoryStore.members.set(roomId, members);
    }

    if (!members.has(socketId) && members.size >= MAX_ROOM_MEMBERS) {
      return { success: false, error: 'Phòng đã đủ 5 người' };
    }

    members.set(socketId, currentUser);

    memoryStore.users.set(socketId, { roomId, displayName: userDisplayName, joinedAt: new Date().toISOString() });

    console.log(`⚠️ User ${userDisplayName} joined room ${roomId} in memory`);
    return {
      success: true,
      users: Array.from(members.values()),
      currentUser,
      startTime: parseInt(roomData.startTime, 10),
    };
  }

  const roomKey = KEYS.room(roomId);
  const membersKey = KEYS.roomMembers(roomId);
  
  let roomData = await redis.hgetall(roomKey);
  if (!roomData || Object.keys(roomData).length === 0) {
    return { success: false, error: 'Room does not exist' };
  }
  
  // Check password
  if (roomData.hasPassword === '1' && roomData.password !== password) {
    return { 
      success: false, 
      error: 'Invalid password',
      requiresPassword: true 
    };
  }

  const userData = JSON.stringify(currentUser);
  const joinAllowed = await redis.eval(
    `
      if redis.call('HEXISTS', KEYS[1], ARGV[1]) == 1 then
        redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
        return 1
      end

      if redis.call('HLEN', KEYS[1]) >= tonumber(ARGV[3]) then
        return 0
      end

      redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
      return 1
    `,
    1,
    membersKey,
    socketId,
    userData,
    MAX_ROOM_MEMBERS.toString()
  );

  if (Number(joinAllowed) !== 1) {
    return { success: false, error: 'Phòng đã đủ 5 người' };
  }
  
  await redis.expire(membersKey, ROOM_TTL);
  
  // Store user session
  await redis.hset(KEYS.user(socketId), {
    roomId,
    displayName: userDisplayName,
    joinedAt: new Date().toISOString(),
  });
  await redis.expire(KEYS.user(socketId), ROOM_TTL);
  
  // Get all users in room
  const membersData = await redis.hgetall(membersKey);
  const users = Object.values(membersData).map(u => JSON.parse(u));
  
  return { 
    success: true, 
    users,
    currentUser,
    startTime: parseInt(roomData.startTime, 10),
  };
}

/**
 * Leave a room
 * @param {string} roomId 
 * @param {string} socketId 
 * @returns {Promise<Array>} remaining users
 */
async function leaveRoom(roomId, socketId) {
  if (!isRedisAvailable()) {
    // Fallback to memory
    const members = memoryStore.members.get(roomId);
    if (members) {
      members.delete(socketId);
      if (members.size === 0) {
        memoryStore.rooms.delete(roomId);
        memoryStore.members.delete(roomId);
        memoryStore.chat.delete(roomId);
      }
    }
    memoryStore.users.delete(socketId);
    return members ? Array.from(members.values()) : [];
  }

  const roomKey = KEYS.room(roomId);
  const membersKey = KEYS.roomMembers(roomId);
  
  // Remove user from room members
  await redis.hdel(membersKey, socketId);
  
  // Remove user session
  await redis.del(KEYS.user(socketId));
  
  // Check remaining users
  const remainingCount = await redis.hlen(membersKey);
  
  if (remainingCount === 0) {
    // Delete room if empty
    await redis.del(roomKey);
    await redis.del(membersKey);
    await redis.del(KEYS.roomChat(roomId));
    await redis.srem(KEYS.activeRooms, roomId);
    return [];
  }
  
  // Get remaining users
  const membersData = await redis.hgetall(membersKey);
  return Object.values(membersData).map(u => JSON.parse(u));
}

/**
 * Get all users in a room
 * @param {string} roomId 
 * @returns {Promise<Array>}
 */
async function getRoomUsers(roomId) {
  if (!isRedisAvailable()) {
    const members = memoryStore.members.get(roomId);
    return members ? Array.from(members.values()) : [];
  }

  const membersKey = KEYS.roomMembers(roomId);
  const membersData = await redis.hgetall(membersKey);
  
  if (!membersData || Object.keys(membersData).length === 0) {
    return [];
  }
  
  return Object.values(membersData).map(u => JSON.parse(u));
}

/**
 * Get user info
 * @param {string} roomId 
 * @param {string} socketId 
 * @returns {Promise<object|null>}
 */
async function getUser(roomId, socketId) {
  if (!isRedisAvailable()) {
    const members = memoryStore.members.get(roomId);
    return members ? members.get(socketId) || null : null;
  }

  const membersKey = KEYS.roomMembers(roomId);
  const userData = await redis.hget(membersKey, socketId);
  
  if (!userData) return null;
  return JSON.parse(userData);
}

/**
 * Get user session (for disconnect handling)
 * @param {string} socketId 
 * @returns {Promise<object|null>}
 */
async function getUserSession(socketId) {
  if (!isRedisAvailable()) {
    return memoryStore.users.get(socketId) || null;
  }

  const userSession = await redis.hgetall(KEYS.user(socketId));
  if (!userSession || Object.keys(userSession).length === 0) {
    return null;
  }
  return userSession;
}

/**
 * Get room info
 * @param {string} roomId 
 * @returns {Promise<object|null>}
 */
async function getRoom(roomId) {
  if (!isRedisAvailable()) {
    const roomData = memoryStore.rooms.get(roomId);
    if (!roomData) return null;
    return {
      ...roomData,
      hasPassword: roomData.hasPassword === '1',
      startTime: parseInt(roomData.startTime, 10),
    };
  }

  const roomKey = KEYS.room(roomId);
  const roomData = await redis.hgetall(roomKey);
  
  if (!roomData || Object.keys(roomData).length === 0) {
    return null;
  }
  
  return {
    ...roomData,
    hasPassword: roomData.hasPassword === '1',
    startTime: parseInt(roomData.startTime, 10),
  };
}

/**
 * Check if room exists (simple check)
 * @param {string} roomId 
 * @returns {Promise<boolean>}
 */
async function roomExists(roomId) {
  if (!isRedisAvailable()) {
    return memoryStore.rooms.has(roomId);
  }
  return await redis.exists(KEYS.room(roomId)) === 1;
}

/**
 * Save chat message (keep last 100 messages)
 * @param {string} roomId 
 * @param {object} message 
 */
async function saveChatMessage(roomId, message) {
  if (!isRedisAvailable()) {
    let chatHistory = memoryStore.chat.get(roomId);
    if (!chatHistory) {
      chatHistory = [];
      memoryStore.chat.set(roomId, chatHistory);
    }
    chatHistory.unshift(message);
    if (chatHistory.length > 100) {
      chatHistory.pop();
    }
    return;
  }

  const chatKey = KEYS.roomChat(roomId);
  await redis.lpush(chatKey, JSON.stringify(message));
  await redis.ltrim(chatKey, 0, 99); // Keep last 100 messages
  await redis.expire(chatKey, ROOM_TTL);
}

/**
 * Get chat history
 * @param {string} roomId 
 * @param {number} limit 
 * @returns {Promise<Array>}
 */
async function getChatHistory(roomId, limit = 50) {
  if (!isRedisAvailable()) {
    const chatHistory = memoryStore.chat.get(roomId) || [];
    return chatHistory.slice(0, limit).reverse();
  }

  const chatKey = KEYS.roomChat(roomId);
  const messages = await redis.lrange(chatKey, 0, limit - 1);
  return messages.map(m => JSON.parse(m)).reverse();
}

module.exports = { 
  createRoom, 
  checkRoom, 
  joinRoom, 
  leaveRoom, 
  getRoomUsers, 
  getUser,
  getUserSession,
  getRoom,
  roomExists,
  saveChatMessage,
  getChatHistory,
};
