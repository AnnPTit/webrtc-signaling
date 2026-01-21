const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:4200", "http://localhost:3000"],
    methods: ["GET", "POST"],
    credentials: true
  }
});

app.use(express.static("public"));

require("./socket")(io);

server.listen(3000, () => {
  console.log("NodeJS signaling server running at :3000");
});
