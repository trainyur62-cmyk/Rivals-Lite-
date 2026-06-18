let canvas;
let ctx;
let statusText;
let roomStatusText;
let hud;
let gameInfoText;
let playerInfoText;

let WIDTH;
let HEIGHT;

const keys = {};
const mouse = { x: 0, y: 0 };
const lastShot = { p1: 0, p2: 0 };
let socket;
let roomCode = null;
let isHost = false;
let isConnected = false;
let localPlayerId = 'p1';
let reconnectAttempts = 0;
const maxReconnectDelay = 10; // seconds

const weapons = {
  primary: {
    name: 'Rapid Pulse',
    fireRate: 0.08,
    bulletSpeed: 1000,
    bulletSize: 4,
    damage: 5,
    color: '#64d9ff',
  },
  secondary: {
    name: 'Impact Rocket',
    fireRate: 0.5,
    bulletSpeed: 500,
    bulletSize: 12,
    damage: 20,
    color: '#ffb86c',
  },
};

const players = [
  {
    id: 'p1',
    x: 0,
    y: 0,
    radius: 16,
    speed: 240,
    color: '#80c6ff',
    weapon: 'secondary',
    aimX: 0,
    aimY: 0,
    health: 150,
    lastDamageTime: 0,
  },
  {
    id: 'p2',
    x: 0,
    y: 0,
    radius: 16,
    speed: 220,
    color: '#ff4444',
    weapon: 'primary',
    aimX: 0,
    aimY: 0,
    health: 150,
    lastDamageTime: 0,
  },
];

let bullets = [];
let restartTimer = 0;
const restartDelay = 3; // seconds until automatic restart after win
let roundOver = false;
const scores = { Blue: 0, Red: 0 };
const walls = [
  { x: 120, y: 540, w: 320, h: 24 },
  { x: 360, y: 320, w: 24, h: 180 },
  { x: 850, y: 520, w: 360, h: 24 },
  { x: 940, y: 220, w: 24, h: 220 },
];

const hills = [
  { x: 520, y: 210, radius: 140, color: '#2f5a47' },
  { x: 860, y: 130, radius: 120, color: '#234d42' },
  { x: 190, y: 140, radius: 100, color: '#2f5a47' },
];

function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

function getDeltaTime(timestamp) {
  if (!getDeltaTime.last) {
    getDeltaTime.last = timestamp;
    return 0;
  }
  const delta = (timestamp - getDeltaTime.last) / 1000;
  getDeltaTime.last = timestamp;
  return delta;
}

function updatePlayer(player, dt) {
  let dx = 0;
  let dy = 0;

  // If connected to a room, only apply input to the local player
  const applyInput = !roomCode || player.id === localPlayerId;
  if (!applyInput) return;

  if (keys.w) dy -= 1;
  if (keys.s) dy += 1;
  if (keys.a) dx -= 1;
  if (keys.d) dx += 1;
  player.aimX = mouse.x;
  player.aimY = mouse.y;

  if (dx !== 0 || dy !== 0) {
    const mag = Math.hypot(dx, dy);
    dx /= mag;
    dy /= mag;
  }

  player.x += dx * player.speed * dt;
  player.y += dy * player.speed * dt;

  player.x = clamp(player.x, player.radius, WIDTH - player.radius);
  player.y = clamp(player.y, player.radius, HEIGHT - player.radius);
}

function shootWeapon(player) {
  const now = performance.now() / 1000;
  const shotKey = player.id;
  const config = weapons[player.weapon];

  if (now - lastShot[shotKey] < config.fireRate) return;

  const angle = Math.atan2(player.aimY - player.y, player.aimX - player.x);
  bullets.push({
    owner: player.id,
    x: player.x + Math.cos(angle) * player.radius,
    y: player.y + Math.sin(angle) * player.radius,
    vx: Math.cos(angle) * config.bulletSpeed,
    vy: Math.sin(angle) * config.bulletSpeed,
    lifetime: 1.5,
    size: config.bulletSize,
    color: config.color,
    damage: config.damage,
  });

  lastShot[shotKey] = now;
}

function updateBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.lifetime -= dt;

    const offscreen = b.x < -50 || b.x > WIDTH + 50 || b.y < -50 || b.y > HEIGHT + 50;
    if (offscreen || b.lifetime <= 0) {
      bullets.splice(i, 1);
      continue;
    }

    let removed = false;
    for (const wall of walls) {
      if (b.x > wall.x && b.x < wall.x + wall.w && b.y > wall.y && b.y < wall.y + wall.h) {
        bullets.splice(i, 1);
        removed = true;
        break;
      }
    }
    if (removed) continue;

    for (const player of players) {
      if (player.id !== b.owner && player.health > 0) {
        const dx = b.x - player.x;
        const dy = b.y - player.y;
        if (Math.hypot(dx, dy) < player.radius + b.size) {
          player.health = Math.max(0, player.health - b.damage);
          player.lastDamageTime = performance.now() / 1000;
          bullets.splice(i, 1);
          removed = true;
          break;
        }
      }
    }
    if (removed) continue;
  }
}

function regenerateHealth(dt) {
  const now = performance.now() / 1000;
  const REGEN_DELAY = 5; // seconds of no damage before healing starts
  const REGEN_RATE = 1; // HP per second (5 HP per 5 seconds)
  const MAX_HEALTH = 150;

  for (const player of players) {
    if (player.health < MAX_HEALTH && player.health > 0) {
      const timeSinceDamage = now - player.lastDamageTime;
      if (timeSinceDamage >= REGEN_DELAY) {
        player.health = Math.min(MAX_HEALTH, player.health + REGEN_RATE * dt);
      }
    }
  }
}

function resetGame() {
  bullets = [];
  players[0].health = 150;
  players[0].lastDamageTime = 0;
  players[1].health = 150;
  players[1].lastDamageTime = 0;
  players[0].weapon = 'secondary';
  players[1].weapon = 'primary';

  // Spawn players near opposite side walls
  players[0].x = 40;
  players[0].y = HEIGHT / 2;
  players[0].aimX = players[0].x + 100;
  players[0].aimY = players[0].y;

  players[1].x = WIDTH - 40;
  players[1].y = HEIGHT / 2;
  players[1].aimX = players[1].x - 100;
  players[1].aimY = players[1].y;

  restartTimer = 0;
  getDeltaTime.last = null;
  // don't reset scores here - scoreboard persists across rounds
}

function drawCanvasScoreboard() {
  ctx.save();
  const padding = 10;
  const text = `Blue ${scores.Blue}  •  Red ${scores.Red}`;
  ctx.font = '16px Inter, system-ui, sans-serif';
  const metrics = ctx.measureText(text);
  const w = metrics.width + padding * 2;
  const h = 28;
  const x = WIDTH - w - 12;
  const y = 12;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'left';
  ctx.fillText(text, x + padding, y + 18);
  ctx.restore();
}

function drawSky() {
  const gradient = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  gradient.addColorStop(0, '#0d2230');
  gradient.addColorStop(0.5, '#17384a');
  gradient.addColorStop(1, '#081317');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

function drawGround() {
  ctx.fillStyle = '#11232b';
  ctx.fillRect(0, HEIGHT * 0.65, WIDTH, HEIGHT * 0.35);
}

function drawHills() {
  for (const hill of hills) {
    ctx.beginPath();
    ctx.fillStyle = hill.color;
    ctx.arc(hill.x, hill.y + 80, hill.radius, Math.PI, 2 * Math.PI);
    ctx.fill();
  }
}

function drawWalls() {
  ctx.fillStyle = '#5a6b75';
  ctx.strokeStyle = '#a6b7c3';
  ctx.lineWidth = 2;
  for (const wall of walls) {
    ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
    ctx.strokeRect(wall.x, wall.y, wall.w, wall.h);
  }
}

function drawPlayer(player) {
  ctx.save();
  ctx.translate(player.x, player.y);
  const angle = Math.atan2(player.aimY - player.y, player.aimX - player.x);
  ctx.rotate(angle);

  ctx.fillStyle = player.color;
  ctx.beginPath();
  ctx.arc(0, 0, player.radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#0c1c28';
  ctx.fillRect(0, -6, player.radius + 16, 12);
  // Draw team label above player
  ctx.restore();
  ctx.save();
  ctx.translate(player.x, player.y - player.radius - 10);
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(-30, -14, 60, 20);
  ctx.fillStyle = '#ffffff';
  ctx.font = '12px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(getTeamName(player), 0, 2);
  ctx.restore();
}

function getTeamName(player) {
  return player.id === 'p1' ? 'Blue' : 'Red';
}

function drawBullets() {
  for (const b of bullets) {
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.size, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawReticle() {
  ctx.strokeStyle = '#ffffffcc';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(mouse.x, mouse.y, 12, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(mouse.x - 16, mouse.y);
  ctx.lineTo(mouse.x + 16, mouse.y);
  ctx.moveTo(mouse.x, mouse.y - 16);
  ctx.lineTo(mouse.x, mouse.y + 16);
  ctx.stroke();
}

function drawScene() {
  drawSky();
  // Draw room code overlay on canvas
  if (roomCode) {
    drawCodeOverlay(roomCode);
  }
  drawHills();
  drawGround();
  drawWalls();

  for (const player of players) {
    drawPlayer(player);
  }

  drawBullets();
  drawReticle();

  const playerTexts = players.map((player) => {
    const hp = Math.ceil(player.health);
    return `${getTeamName(player)}: ${hp}/150 | ${weapons[player.weapon].name}`;
  }).join(' / ');

  const alive = players.filter((player) => player.health > 0);
  if (alive.length === 1) {
    const winner = alive[0];
    const team = getTeamName(winner);
    statusText.innerHTML = `${team} (${winner.id.toUpperCase()}) wins!`;
    if (!roundOver) {
      scores[team] = (scores[team] || 0) + 1;
      roundOver = true;
    }
    if (restartTimer > 0) {
      statusText.innerHTML += ` Restarting in ${Math.ceil(restartTimer)}...`;
    }
  } else {
    statusText.innerHTML = `Playing online. ${playerTexts}`;
  }

  if (gameInfoText) {
    gameInfoText.textContent = roomCode ? `Room: ${roomCode}` : 'Not connected';
  }
  if (playerInfoText) {
    const local = players.find((p) => p.id === localPlayerId);
    if (local && roomCode) {
      playerInfoText.textContent = `You: ${getTeamName(local)} (${local.id.toUpperCase()})`;
    } else {
      playerInfoText.textContent = isHost ? 'You are host' : 'You are guest';
    }
  }
}

function drawCodeOverlay(code) {
  const padding = 8;
  ctx.save();
  ctx.font = '20px Inter, system-ui, sans-serif';
  const text = `Code: ${code}`;
  const metrics = ctx.measureText(text);
  const w = metrics.width + padding * 2;
  const h = 28 + padding * 1;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.fillRect(12, 12, w, h);
  ctx.strokeRect(12, 12, w, h);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, 12 + padding, 12 + 20);
  ctx.restore();
}

function sendState() {
  if (!socket || socket.readyState !== WebSocket.OPEN || !roomCode) return;
  // send only local player's state and bullets owned by local player
  const local = players.find((p) => p.id === localPlayerId);
  if (!local) return;
  const payload = {
    players: [{ id: local.id, x: local.x, y: local.y, aimX: local.aimX, aimY: local.aimY, weapon: local.weapon, health: local.health }],
    bullets: bullets.filter((b) => b.owner === local.id),
  };
  socket.send(JSON.stringify({ type: 'state', payload }));
}

function loop(timestamp) {
  const dt = getDeltaTime(timestamp);
  players.forEach((player) => updatePlayer(player, dt));
  updateBullets(dt);
  regenerateHealth(dt);
  drawScene();

  if (socket && socket.readyState === WebSocket.OPEN) {
    sendState();
  }

  // Handle automatic restart after win
  const alive2 = players.filter((p) => p.health > 0);
  if (alive2.length === 1) {
    if (restartTimer <= 0) {
      restartTimer = restartDelay;
    } else {
      restartTimer -= dt;
      if (restartTimer <= 0) {
        resetGame();
      }
    }
  } else {
    restartTimer = 0;
    roundOver = false;
  }

  // Update HUD scoreboard DOM if present
  if (gameInfoText) {
    const sb = document.getElementById('scoreboard');
    const sbB = document.getElementById('scoreBlue');
    const sbR = document.getElementById('scoreRed');
    if (sbB) sbB.textContent = `Blue: ${scores.Blue}`;
    if (sbR) sbR.textContent = `Red: ${scores.Red}`;
  }

  // Draw small canvas scoreboard
  drawCanvasScoreboard();

  requestAnimationFrame(loop);
  // Attempt to connect to the game server immediately so multiplayer can join
  connectSocket();
}

function connectSocket() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${protocol}://${window.location.host}`);

  socket.addEventListener('open', () => {
    isConnected = true;
    reconnectAttempts = 0;
    roomStatusText.textContent = 'Connected to server.';
  });

  socket.addEventListener('error', (err) => {
    console.warn('WebSocket error', err);
    roomStatusText.textContent = 'WebSocket error';
  });

  socket.addEventListener('message', (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'created') {
      roomCode = data.code;
      isHost = true;
      roomStatusText.textContent = `Room created: ${roomCode}`;
      localPlayerId = data.playerId || 'p1';
    }
    if (data.type === 'joined') {
      roomCode = data.code;
      isHost = false;
      roomStatusText.textContent = `Joined room: ${roomCode}`;
      localPlayerId = data.playerId || 'p2';
    }
    if (data.type === 'roomReady') {
      roomStatusText.textContent = `Room ready: ${data.code}`;
    }
    if (data.type === 'state') {
      const remote = players.find((p) => p.id === data.from);
      if (remote) {
        const incoming = data.payload.players.find((p) => p.id === remote.id);
        if (incoming) {
          remote.x = incoming.x;
          remote.y = incoming.y;
          remote.aimX = incoming.aimX;
          remote.aimY = incoming.aimY;
          remote.weapon = incoming.weapon;
          remote.health = incoming.health;
        }
      }
      if (data.payload.bullets) {
        bullets = bullets.filter((bullet) => bullet.owner !== data.from);
        bullets.push(...data.payload.bullets.map((bullet) => ({ ...bullet, owner: data.from })));
      }
    }
    if (data.type === 'error') {
      roomStatusText.textContent = `Error: ${data.message}`;
    }
  });

  socket.addEventListener('close', () => {
    isConnected = false;
    roomStatusText.textContent = 'Disconnected from server.';
    // attempt reconnect with backoff
    reconnectAttempts++;
    const delay = Math.min(maxReconnectDelay, Math.pow(2, reconnectAttempts)) * 1000;
    setTimeout(() => {
      roomStatusText.textContent = `Reconnecting... (attempt ${reconnectAttempts})`;
      connectSocket();
    }, delay);
  });
}

function initUI() {
  statusText = document.getElementById('status');
  roomStatusText = document.getElementById('roomStatus');
  hud = document.getElementById('hud');
  gameInfoText = document.getElementById('gameInfo');
  playerInfoText = document.getElementById('playerInfo');

  const menu = document.getElementById('menu');
  const createRoomBtn = document.getElementById('createRoom');
  const showJoinBtn = document.getElementById('showJoin');
  const joinControls = document.getElementById('joinControls');
  const roomCodeInput = document.getElementById('roomCode');
  const joinRoomBtn = document.getElementById('joinRoom');

  joinControls.style.display = 'none';
  hud.style.display = 'none';

  function sendSocketMessage(message) {
    if (!socket) connectSocket();
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    } else {
      socket.addEventListener('open', () => {
        socket.send(JSON.stringify(message));
      }, { once: true });
    }
  }

  createRoomBtn.addEventListener('click', () => {
    sendSocketMessage({ type: 'create' });
    menu.style.display = 'none';
    hud.style.display = 'block';
  });

  showJoinBtn.addEventListener('click', () => {
    joinControls.style.display = 'block';
  });

  joinRoomBtn.addEventListener('click', () => {
    const code = roomCodeInput.value.trim();
    if (!code) {
      roomStatusText.textContent = 'Enter a join code.';
      return;
    }
    sendSocketMessage({ type: 'join', code });
    menu.style.display = 'none';
    hud.style.display = 'block';
  });
}

function initGame() {
  canvas = document.getElementById('gameCanvas');
  ctx = canvas.getContext('2d');

  statusText = document.getElementById('status');

  WIDTH = canvas.width;
  HEIGHT = canvas.height;
  mouse.x = WIDTH / 2;
  mouse.y = HEIGHT / 2;

  // Start players at opposite side walls
  players[0].x = 40;
  players[0].y = HEIGHT / 2;
  players[0].aimX = players[0].x + 100;
  players[0].aimY = players[0].y;

  players[1].x = WIDTH - 40;
  players[1].y = HEIGHT / 2;
  players[1].aimX = players[1].x - 100;
  players[1].aimY = players[1].y;

  const setMovementKey = (key, value) => {
    if (['w', 'a', 's', 'd'].includes(key)) {
      keys[key] = value;
    }
  };

  window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    const activeElement = document.activeElement;
    const isInputFocused = activeElement?.tagName === 'INPUT' || activeElement?.tagName === 'TEXTAREA';

    // Only prevent default and handle game input if not typing in an input field
    if (!isInputFocused && ['w', 'a', 's', 'd', ' ', 'e', 'p', 'o'].includes(key)) {
      event.preventDefault();
    }

    if (!isInputFocused) {
      setMovementKey(key, true);
      const local = players.find((p) => p.id === localPlayerId) || players[0];
      if (key === 'e' || key === 'p') {
        local.weapon = local.weapon === 'primary' ? 'secondary' : 'primary';
      }
      if (key === 'o' || key === ' ') {
        shootWeapon(local);
      }
    }
  });

  window.addEventListener('keyup', (event) => {
    const key = event.key.toLowerCase();
    const activeElement = document.activeElement;
    const isInputFocused = activeElement?.tagName === 'INPUT' || activeElement?.tagName === 'TEXTAREA';

    if (!isInputFocused) {
      setMovementKey(key, false);
    }
  });

  canvas.addEventListener('mousemove', (event) => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = event.clientX - rect.left;
    mouse.y = event.clientY - rect.top;
  });

  canvas.addEventListener('mousedown', (event) => {
    if (event.button === 0) {
      const local = players.find((p) => p.id === localPlayerId) || players[0];
      shootWeapon(local);
    }
  });

  canvas.addEventListener('contextmenu', (event) => {
    event.preventDefault();
  });

  window.addEventListener('blur', () => {
    Object.keys(keys).forEach((key) => {
      keys[key] = false;
    });
  });

  requestAnimationFrame(loop);
  connectSocket();
}

window.addEventListener('load', () => {
  initUI();
  initGame();
});

window.addEventListener('error', (event) => {
  if (statusText) {
    statusText.textContent = `Error: ${event.message}`;
  } else {
    console.error(event.message);
  }
});

window.addEventListener('unhandledrejection', (event) => {
  if (statusText) {
    statusText.textContent = `Promise error: ${event.reason}`;
  } else {
    console.error(event.reason);
  }
});
