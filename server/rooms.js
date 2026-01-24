const rooms = {};

function createRoom(roomId, password = null) {
  if (rooms[roomId]) {
    return { success: false, error: 'Room already exists' };
  }
  rooms[roomId] = {
    users: new Set(),
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

function joinRoom(roomId, socketId, password = null) {
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
  
  room.users.add(socketId);
  return { success: true, users: [...room.users] };
}

function leaveRoom(roomId, socketId) {
  if (!rooms[roomId]) return [];
  rooms[roomId].users.delete(socketId);
  
  // Delete room if empty
  if (rooms[roomId].users.size === 0) {
    delete rooms[roomId];
    return [];
  }
  
  return [...rooms[roomId].users];
}

function getRoomUsers(roomId) {
  if (!rooms[roomId]) return [];
  return [...rooms[roomId].users];
}

module.exports = { rooms, createRoom, checkRoom, joinRoom, leaveRoom, getRoomUsers };
