const rooms = {};

function createRoom(roomId, password = null) {
  if (rooms[roomId]) {
    return { success: false, error: 'Room already exists' };
  }
  rooms[roomId] = {
    users: new Map(), // Map<socketId, { id, displayName }>
    password: password || null,
    hasPassword: !!password
  };
  return { success: true, hasPassword: !!password };
}

function checkRoom(roomId) {
  if (!rooms[roomId]) {
    return { exists: false };
  }
  return {
    exists: true,
    hasPassword: rooms[roomId].hasPassword,
    userCount: rooms[roomId].users.size
  };
}

function joinRoom(roomId, socketId, password = null, displayName = null) {
  if (!rooms[roomId]) {
    return { success: false, error: 'Room does not exist' };
  }
  
  const room = rooms[roomId];
  
  if (room.hasPassword && room.password !== password) {
    return { 
      success: false, 
      error: 'Invalid password',
      requiresPassword: true 
    };
  }
  
  // Store user with displayName
  const userDisplayName = displayName || `User-${socketId.slice(0, 6)}`;
  room.users.set(socketId, { id: socketId, displayName: userDisplayName });
  
  return { 
    success: true, 
    users: [...room.users.values()],
    currentUser: { id: socketId, displayName: userDisplayName }
  };
}

function leaveRoom(roomId, socketId) {
  if (!rooms[roomId]) return [];
  rooms[roomId].users.delete(socketId);
  
  // Delete room if empty
  if (rooms[roomId].users.size === 0) {
    delete rooms[roomId];
    return [];
  }
  
  return [...rooms[roomId].users.values()];
}

function getRoomUsers(roomId) {
  if (!rooms[roomId]) return [];
  return [...rooms[roomId].users.values()];
}

function getUser(roomId, socketId) {
  if (!rooms[roomId]) return null;
  return rooms[roomId].users.get(socketId) || null;
}

module.exports = { rooms, createRoom, checkRoom, joinRoom, leaveRoom, getRoomUsers, getUser };
