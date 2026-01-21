const rooms = {};

function joinRoom(roomId, socketId) {
  if (!rooms[roomId]) rooms[roomId] = new Set();
  rooms[roomId].add(socketId);
  return [...rooms[roomId]];
}

function leaveRoom(roomId, socketId) {
  if (!rooms[roomId]) return [];
  rooms[roomId].delete(socketId);
  return [...rooms[roomId]];
}

module.exports = { rooms, joinRoom, leaveRoom };
