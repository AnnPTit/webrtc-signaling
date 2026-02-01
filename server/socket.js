const { createRoom, checkRoom, joinRoom, leaveRoom, getRoomUsers, getUser, getUserSession, roomExists, saveChatMessage, getChatHistory } = require("./rooms");
const { startTranscription, sendAudioData, stopTranscription, hasActiveSession } = require("./transcription");

module.exports = (io) => {
  io.on("connection", (socket) => {
    // Store roomId in socket for backup (in case Redis data is lost)
    socket.currentRoomId = null;
    socket.displayName = null;

    socket.on("create-room", async ({ roomId, password }) => {
      try {
        const result = await createRoom(roomId, password);
        if (result.success) {
          socket.emit("room-created", { 
            roomId, 
            hasPassword: result.hasPassword,
            startTime: result.startTime 
          });
        } else {
          socket.emit("create-room-error", { error: result.error });
        }
      } catch (error) {
        console.error("Error creating room:", error);
        socket.emit("create-room-error", { error: "Failed to create room" });
      }
    });

    socket.on("check-room", async ({ roomId }) => {
      try {
        const result = await checkRoom(roomId);
        if (!result.exists) {
          socket.emit("join-result", { success: false, error: 'Room does not exist' });
        } else if (result.hasPassword) {
          socket.emit("join-result", { success: false, requiresPassword: true });
        } else {
          // Room exists and no password required, auto join
          socket.emit("join-result", { success: true, requiresPassword: false });
        }
      } catch (error) {
        console.error("Error checking room:", error);
        socket.emit("join-result", { success: false, error: "Failed to check room" });
      }
    });

    socket.on("join-room", async ({ roomId, password, displayName }) => {
      try {
        // If room doesn't exist, create it (for backward compatibility)
        const exists = await roomExists(roomId);
        if (!exists) {
          await createRoom(roomId, password);
        }
        
        const result = await joinRoom(roomId, socket.id, password, displayName);
        
        if (result.success) {
          socket.join(roomId);
          
          // Store in socket for backup
          socket.currentRoomId = roomId;
          socket.displayName = result.currentUser.displayName;
          
          // Get chat history for the room
          const chatHistory = await getChatHistory(roomId);
          
          socket.emit("join-result", { 
            success: true,
            startTime: result.startTime 
          });
          
          // Send list of other users (excluding current user)
          socket.emit("room-users", result.users.filter(user => user.id !== socket.id));
          
          // Send chat history
          if (chatHistory.length > 0) {
            socket.emit("chat-history", chatHistory);
          }
          
          // Notify other users with new user's info including displayName
          socket.to(roomId).emit("user-joined", result.currentUser);
        } else {
          socket.emit("join-result", { 
            success: false, 
            error: result.error,
            requiresPassword: result.requiresPassword 
          });
        }
      } catch (error) {
        console.error("Error joining room:", error);
        socket.emit("join-result", { success: false, error: "Failed to join room" });
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

    socket.on("chat", async ({ roomId, message }) => {
      try {
        // Get user info to include displayName in chat message
        const user = await getUser(roomId, socket.id);
        const chatMessage = {
          from: socket.id,
          fromName: user ? user.displayName : null,
          message,
          time: new Date().toISOString()
        };
        
        // Save to Redis
        await saveChatMessage(roomId, chatMessage);
        
        io.to(roomId).emit("chat", chatMessage);
      } catch (error) {
        console.error("Error sending chat:", error);
      }
    });

    socket.on("reaction", async ({ roomId, emoji }) => {
      try {
        const user = await getUser(roomId, socket.id);
        const fromName = user?.displayName || socket.id.slice(0, 8);
        
        // Broadcast reaction to all users in room
        io.to(roomId).emit("reaction", {
          from: socket.id,
          fromName: fromName,
          emoji: emoji
        });
      } catch (error) {
        console.error("Error sending reaction:", error);
      }
    });

    socket.on("leave-room", async ({ roomId }) => {
      try {
        await leaveRoom(roomId, socket.id);
        socket.leave(roomId);
        socket.currentRoomId = null;
        socket.displayName = null;
        // Broadcast to all remaining users in room
        io.to(roomId).emit("user-left", socket.id);
      } catch (error) {
        console.error("Error leaving room:", error);
      }
    });

    socket.on("disconnect", async () => {
      try {
        // Stop any active transcription session
        if (hasActiveSession(socket.id)) {
          await stopTranscription(socket.id);
        }
        
        // Try to get roomId from Redis first, fallback to socket backup
        let roomId = null;
        
        const userSession = await getUserSession(socket.id);
        if (userSession && userSession.roomId) {
          roomId = userSession.roomId;
        } else if (socket.currentRoomId) {
          // Fallback to socket-stored roomId (Redis data might be lost)
          roomId = socket.currentRoomId;
          console.log(`⚠️ Using socket backup for roomId: ${roomId}`);
        }
        
        if (roomId) {
          await leaveRoom(roomId, socket.id);
          // Use io.to() instead of socket.to() because socket has already left all rooms on disconnect
          io.to(roomId).emit("user-left", socket.id);
        }
      } catch (error) {
        console.error("Error handling disconnect:", error);
        // Final fallback: use socket backup even if leaveRoom fails
        if (socket.currentRoomId) {
          io.to(socket.currentRoomId).emit("user-left", socket.id);
        }
      }
    });

    // =====================
    // TRANSCRIPTION EVENTS
    // =====================

    socket.on("start-transcription", async ({ roomId }) => {
      try {
        const displayName = socket.displayName || `User-${socket.id.slice(0, 6)}`;
        
        const result = await startTranscription(socket.id, roomId, displayName, (transcript) => {
          // Broadcast transcript to all users in the room
          io.to(roomId).emit("subtitle", {
            type: transcript.type,
            text: transcript.text,
            from: transcript.socketId,
            fromName: transcript.displayName,
            timestamp: transcript.timestamp,
          });
        });

        if (result.success) {
          socket.emit("transcription-started", { success: true });
          // Notify room that user enabled captions
          socket.to(roomId).emit("user-transcription-status", {
            userId: socket.id,
            displayName,
            enabled: true,
          });
        } else {
          socket.emit("transcription-started", { success: false, error: result.error });
        }
      } catch (error) {
        console.error("Error starting transcription:", error);
        socket.emit("transcription-started", { success: false, error: "Failed to start transcription" });
      }
    });

    socket.on("audio-data", ({ audioData }) => {
      try {
        if (hasActiveSession(socket.id)) {
          sendAudioData(socket.id, audioData);
        }
      } catch (error) {
        console.error("Error processing audio data:", error);
      }
    });

    socket.on("stop-transcription", async ({ roomId }) => {
      try {
        await stopTranscription(socket.id);
        socket.emit("transcription-stopped", { success: true });
        // Notify room that user disabled captions
        socket.to(roomId).emit("user-transcription-status", {
          userId: socket.id,
          displayName: socket.displayName || `User-${socket.id.slice(0, 6)}`,
          enabled: false,
        });
      } catch (error) {
        console.error("Error stopping transcription:", error);
        socket.emit("transcription-stopped", { success: false, error: "Failed to stop transcription" });
      }
    });
  });
};
