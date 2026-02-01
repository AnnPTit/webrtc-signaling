require('dotenv').config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
// Allow all CORS for HTTP endpoints
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );
  next();
});
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.static("public"));

require("./socket")(io);

server.listen(3000, () => {
  console.log("NodeJS signaling server running at :3000");
});
