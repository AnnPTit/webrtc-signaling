const { joinRoom, leaveRoom, rooms } = require("./rooms");

module.exports = (io) => {
  io.on("connection", (socket) => {

    socket.on("join-room", ({ roomId }) => {
      socket.join(roomId);

      const users = joinRoom(roomId, socket.id);

      socket.emit("room-users", users.filter(id => id !== socket.id));
      socket.to(roomId).emit("user-joined", socket.id);
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
