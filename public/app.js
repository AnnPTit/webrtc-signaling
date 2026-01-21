const socket = io();
const peers = {};
const pendingCandidates = {}; // Queue for ICE candidates that arrive before remote description
let localStream;
let screenStream = null;
let roomId;
let mediaReady = false;
let isScreenSharing = false;

async function initMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });
    document.getElementById("local").srcObject = localStream;
    mediaReady = true;
    console.log("Media initialized successfully");
  } catch (err) {
    console.error("Error accessing media devices:", err);
  }
}

initMedia();

function createPeer(peerId) {
  // Close existing peer if any
  if (peers[peerId]) {
    peers[peerId].close();
  }

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });

  // Add connection state logging
  pc.onconnectionstatechange = () => {
    console.log(`Peer ${peerId} connection state:`, pc.connectionState);
  };

  pc.oniceconnectionstatechange = () => {
    console.log(`Peer ${peerId} ICE state:`, pc.iceConnectionState);
  };

  localStream.getTracks().forEach(track =>
    pc.addTrack(track, localStream)
  );  pc.ontrack = e => {
    console.log(`Received track from ${peerId}:`, e.track.kind, "streamId:", e.streams[0]?.id);
    
    const stream = e.streams[0];
    const streamId = stream.id;
    const videoId = `${peerId}-${streamId}`;
    
    let video = document.getElementById(videoId);
    if (!video) {
      video = document.createElement("video");
      video.id = videoId;
      video.autoplay = true;
      video.playsInline = true;
      video.dataset.peerId = peerId;
      video.dataset.streamId = streamId;
      document.getElementById("remotes").appendChild(video);
    }
    video.srcObject = stream;
  };

  pc.onicecandidate = e => {
    if (e.candidate) {
      socket.emit("ice-candidate", {
        to: peerId,
        candidate: e.candidate
      });
    }
  };

  peers[peerId] = pc;
  return pc;
}

function joinRoom() {
  if (!mediaReady) {
    alert("Please wait for camera/microphone to be ready");
    return;
  }
  roomId = document.getElementById("roomId").value;
  socket.emit("join-room", { roomId });
  console.log("Joining room:", roomId);
}

socket.on("room-users", users => {
  console.log("Room users:", users);
  // New user sends offers to existing users
  users.forEach(createOffer);
});

socket.on("user-joined", id => {
  console.log("User joined:", id);
  // Don't create offer here - wait for the new user to send offer to us
});

async function createOffer(id) {
  const pc = createPeer(id);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("offer", { to: id, offer });
}

socket.on("offer", async ({ from, offer }) => {
  const pc = createPeer(from);
  await pc.setRemoteDescription(offer);
  // Process any pending ICE candidates
  if (pendingCandidates[from]) {
    for (const candidate of pendingCandidates[from]) {
      await pc.addIceCandidate(candidate);
    }
    delete pendingCandidates[from];
  }
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit("answer", { to: from, answer });
});

socket.on("answer", async ({ from, answer }) => {
  const pc = peers[from];
  if (pc) {
    await pc.setRemoteDescription(answer);
    // Process any pending ICE candidates
    if (pendingCandidates[from]) {
      for (const candidate of pendingCandidates[from]) {
        await pc.addIceCandidate(candidate);
      }
      delete pendingCandidates[from];
    }
  }
});

socket.on("ice-candidate", async ({ from, candidate }) => {
  const pc = peers[from];
  if (pc && pc.remoteDescription && pc.remoteDescription.type) {
    await pc.addIceCandidate(candidate);
  } else {
    // Queue the candidate if remote description not set yet
    if (!pendingCandidates[from]) {
      pendingCandidates[from] = [];
    }
    pendingCandidates[from].push(candidate);
  }
});

socket.on("user-left", id => {
  peers[id]?.close();
  delete peers[id];
  delete pendingCandidates[id];
  // Remove all video elements for this peer
  document.querySelectorAll(`[data-peer-id="${id}"]`).forEach(el => el.remove());
});


function sendChat() {
  const input = document.getElementById("chatInput");
  socket.emit("chat", {
    roomId,
    message: input.value
  });
  input.value = "";
}

socket.on("chat", msg => {
  const li = document.createElement("li");
  li.textContent = `${msg.from}: ${msg.message}`;
  document.getElementById("chatBox").appendChild(li);
});


async function shareScreen() {
  try {
    if (isScreenSharing) {
      console.log("Already sharing screen");
      return;
    }

    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true
    });
    const screenTrack = screenStream.getVideoTracks()[0];
    isScreenSharing = true;

    // Show screen share in local screen video
    document.getElementById("localScreen").srcObject = screenStream;
    document.getElementById("localScreen").style.display = "block";

    // Add screen track to all peers (as new track, not replacing)
    for (let pc of Object.values(peers)) {
      pc.addTrack(screenTrack, screenStream);
    }

    // Renegotiate with all peers
    for (let [peerId, pc] of Object.entries(peers)) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("offer", { to: peerId, offer });
    }

    // When screen sharing stops
    screenTrack.onended = async () => {
      console.log("Screen sharing ended");
      isScreenSharing = false;
      
      // Hide local screen video
      document.getElementById("localScreen").style.display = "none";
      document.getElementById("localScreen").srcObject = null;

      // Remove screen track from all peers and renegotiate
      for (let [peerId, pc] of Object.entries(peers)) {
        const sender = pc.getSenders().find(s => s.track === screenTrack);
        if (sender) {
          pc.removeTrack(sender);
        }
        // Renegotiate
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit("offer", { to: peerId, offer });
      }

      screenStream = null;
    };    console.log("Screen sharing started");
  } catch (err) {
    console.error("Error sharing screen:", err);
    isScreenSharing = false;
  }
}

function stopShare() {
  if (isScreenSharing && screenStream) {
    const tracks = screenStream.getTracks();
    tracks.forEach(track => track.stop());
  }
}
