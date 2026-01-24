const { createRoom, checkRoom, joinRoom, leaveRoom, getRoomUsers, rooms } = require("./rooms");

module.exports = (io) => {
  io.on("connection", (socket) => {

    socket.on("create-room", ({ roomId, password }) => {
      const result = createRoom(roomId, password);
      if (result.success) {
        socket.emit("room-created", { roomId, hasPassword: result.hasPassword });
      } else {
        socket.emit("create-room-error", { error: result.error });
      }
    });

    socket.on("check-room", ({ roomId }) => {
      const result = checkRoom(roomId);
      if (!result.exists) {
        socket.emit("join-result", { success: false, error: 'Room does not exist' });
      } else if (result.hasPassword) {
        socket.emit("join-result", { success: false, requiresPassword: true });
      } else {
        // Room exists and no password required, auto join
        socket.emit("join-result", { success: true, requiresPassword: false });
      }
    });

    socket.on("join-room", ({ roomId, password }) => {
      // If room doesn't exist, create it (for backward compatibility)
      if (!rooms[roomId]) {
        createRoom(roomId, password);
      }
      
      const result = joinRoom(roomId, socket.id, password);
      
      if (result.success) {
        socket.join(roomId);
        socket.emit("join-result", { success: true });
        socket.emit("room-users", result.users.filter(id => id !== socket.id));
        socket.to(roomId).emit("user-joined", socket.id);
      } else {
        socket.emit("join-result", { 
          success: false, 
          error: result.error,
          requiresPassword: result.requiresPassword 
        });
      }
    });

    socket.on("offer", ({ to, offer }) => {
      socket.to(to).emit("offer", { from: socket.id, offer });
    });

    socket.on("answer", ({ to, answer }) => {
      socket.to(to).emit("answer", { from: socket.id, answer });
    });

    socket.on("ice-candidate", ({ to, candidate }) => {
      socket.to(to).emit("ice-candidate", { from: socket.id, candidate });
    });

    socket.on("chat", ({ roomId, message }) => {
      io.to(roomId).emit("chat", {
        from: socket.id,
        message,
        time: new Date()
      });
    });

    socket.on("disconnect", () => {
      for (const roomId in rooms) {
        leaveRoom(roomId, socket.id);
        socket.to(roomId).emit("user-left", socket.id);
      }
    });
  });
};
