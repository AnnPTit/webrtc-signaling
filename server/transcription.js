const { AssemblyAI } = require('assemblyai');

// AssemblyAI configuration
const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY;

const client = new AssemblyAI({
  apiKey: ASSEMBLYAI_API_KEY,
});

const CONNECTION_PARAMS = {
  sampleRate: 16000,
  formatTurns: true,
  languageCode: 'vi', // Vietnamese
};

// Store active transcription sessions per user
const transcriptionSessions = new Map();

/**
 * Start a transcription session for a user
 * @param {string} socketId - User's socket ID
 * @param {string} roomId - Room ID
 * @param {string} displayName - User's display name
 * @param {Function} onTranscript - Callback when transcript is received
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function startTranscription(socketId, roomId, displayName, onTranscript) {
  try {
    // Check if session already exists
    if (transcriptionSessions.has(socketId)) {
      console.log(`⚠️ Transcription session already exists for ${socketId}`);
      return { success: true, message: 'Session already active' };
    }

    const transcriber = client.streaming.transcriber(CONNECTION_PARAMS);

    transcriber.on('open', ({ id }) => {
      console.log(`🎤 Transcription session opened for ${displayName}: ${id}`);
    });

    transcriber.on('error', (error) => {
      console.error(`❌ Transcription error for ${displayName}:`, error);
    });

    transcriber.on('close', (code, reason) => {
      console.log(`🔇 Transcription session closed for ${displayName}:`, code, reason);
      transcriptionSessions.delete(socketId);
    });

    // Handle partial transcripts (real-time feedback)
    transcriber.on('transcript', (transcript) => {
      if (transcript.text) {
        onTranscript({
          type: 'partial',
          text: transcript.text,
          socketId,
          displayName,
          roomId,
          timestamp: Date.now(),
        });
      }
    });

    // Handle complete turns (final transcripts)
    transcriber.on('turn', (turn) => {
      if (turn.transcript) {
        onTranscript({
          type: 'final',
          text: turn.transcript,
          socketId,
          displayName,
          roomId,
          timestamp: Date.now(),
        });
      }
    });

    console.log(`🎤 Connecting transcription for ${displayName}...`);
    await transcriber.connect();

    transcriptionSessions.set(socketId, {
      transcriber,
      roomId,
      displayName,
      startedAt: Date.now(),
    });

    console.log(`✅ Transcription started for ${displayName} in room ${roomId}`);
    return { success: true };
  } catch (error) {
    console.error(`❌ Failed to start transcription for ${socketId}:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Send audio data to the transcription service
 * @param {string} socketId - User's socket ID
 * @param {Buffer|ArrayBuffer} audioData - Audio data chunk
 * @returns {boolean} - Whether the data was sent successfully
 */
function sendAudioData(socketId, audioData) {
  const session = transcriptionSessions.get(socketId);
  if (!session) {
    return false;
  }

  try {
    // Convert to Buffer if needed
    const buffer = Buffer.isBuffer(audioData) ? audioData : Buffer.from(audioData);
    session.transcriber.sendAudio(buffer);
    return true;
  } catch (error) {
    console.error(`❌ Error sending audio for ${socketId}:`, error);
    return false;
  }
}

/**
 * Stop a transcription session
 * @param {string} socketId - User's socket ID
 * @returns {Promise<void>}
 */
async function stopTranscription(socketId) {
  const session = transcriptionSessions.get(socketId);
  if (!session) {
    return;
  }

  try {
    console.log(`🔇 Stopping transcription for ${session.displayName}...`);
    await session.transcriber.close();
    transcriptionSessions.delete(socketId);
    console.log(`✅ Transcription stopped for ${session.displayName}`);
  } catch (error) {
    console.error(`❌ Error stopping transcription for ${socketId}:`, error);
    transcriptionSessions.delete(socketId);
  }
}

/**
 * Check if a user has an active transcription session
 * @param {string} socketId - User's socket ID
 * @returns {boolean}
 */
function hasActiveSession(socketId) {
  return transcriptionSessions.has(socketId);
}

/**
 * Get all active transcription sessions for a room
 * @param {string} roomId - Room ID
 * @returns {Array} - Array of active sessions info
 */
function getRoomSessions(roomId) {
  const sessions = [];
  transcriptionSessions.forEach((session, socketId) => {
    if (session.roomId === roomId) {
      sessions.push({
        socketId,
        displayName: session.displayName,
        startedAt: session.startedAt,
      });
    }
  });
  return sessions;
}

/**
 * Stop all transcription sessions for a room
 * @param {string} roomId - Room ID
 * @returns {Promise<void>}
 */
async function stopRoomTranscriptions(roomId) {
  const sessions = getRoomSessions(roomId);
  await Promise.all(sessions.map(s => stopTranscription(s.socketId)));
}

module.exports = {
  startTranscription,
  sendAudioData,
  stopTranscription,
  hasActiveSession,
  getRoomSessions,
  stopRoomTranscriptions,
};
