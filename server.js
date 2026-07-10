const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { randomBytes } = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(__dirname));

const rooms = new Map();

function createRoom() {
  const code = randomBytes(2).toString('hex');
  rooms.set(code, { players: [], created: Date.now() });
  return code;
}

function cleanupRooms() {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    if (now - room.created > 1000 * 60 * 15) {
      rooms.delete(code);
    }
  }
}
setInterval(cleanupRooms, 1000 * 60 * 5);

wss.on('connection', (ws) => {
  ws.roomCode = null;
  ws.playerId = null;

  ws.send(JSON.stringify({ type: 'connected' }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'create') {
        const code = createRoom();
        const room = rooms.get(code);
        room.players.push(ws);
        ws.roomCode = code;
        ws.playerId = 'p1';
        ws.send(JSON.stringify({ type: 'created', code, playerId: 'p1' }));
      }
      if (data.type === 'join') {
        const room = rooms.get(data.code);
        if (!room) {
          ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
          return;
        }
        if (room.players.length >= 2) {
          ws.send(JSON.stringify({ type: 'error', message: 'Room full' }));
          return;
        }
        room.players.push(ws);
        ws.roomCode = data.code;
        ws.playerId = 'p2';
        ws.send(JSON.stringify({ type: 'joined', code: data.code, playerId: 'p2' }));
        room.players.forEach((player) => {
          if (player !== ws) {
            player.send(JSON.stringify({ type: 'roomReady', code: data.code }));
          }
        });
      }
      if (data.type === 'resume') {
        const room = rooms.get(data.code);
        if (!room) {
          ws.send(JSON.stringify({ type: 'error', message: 'Room not found or expired' }));
          return;
        }
        if (!['p1', 'p2'].includes(data.playerId)) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid player id' }));
          return;
        }
        const existingIndex = room.players.findIndex((player) => player.playerId === data.playerId);
        if (existingIndex !== -1) {
          room.players[existingIndex] = ws;
          ws.roomCode = data.code;
          ws.playerId = data.playerId;
          ws.send(JSON.stringify({ type: 'rejoined', code: data.code, playerId: data.playerId }));
          room.players.forEach((player) => {
            if (player !== ws) {
              player.send(JSON.stringify({ type: 'roomReady', code: data.code }));
            }
          });
          return;
        }
        if (room.players.length < 2) {
          room.players.push(ws);
          ws.roomCode = data.code;
          ws.playerId = data.playerId;
          ws.send(JSON.stringify({ type: 'rejoined', code: data.code, playerId: data.playerId }));
          room.players.forEach((player) => {
            if (player !== ws) {
              player.send(JSON.stringify({ type: 'roomReady', code: data.code }));
            }
          });
          return;
        }
        ws.send(JSON.stringify({ type: 'error', message: 'Room full' }));
      }
      if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        return;
      }
      if (data.type === 'state' && ws.roomCode) {
        const room = rooms.get(ws.roomCode);
        if (!room) return;
        room.players.forEach((player) => {
          if (player !== ws) {
            player.send(JSON.stringify({ type: 'state', payload: data.payload, from: ws.playerId }));
          }
        });
      }
    } catch (err) {
      console.error('Invalid message', err);
    }
  });

  ws.on('close', () => {
    if (ws.roomCode) {
      const room = rooms.get(ws.roomCode);
      if (room) {
        room.players = room.players.filter((player) => player !== ws);
        if (room.players.length === 0) {
          rooms.delete(ws.roomCode);
        }
      }
    }
  });
});

const PORT = process.env.PORT || 7999;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
