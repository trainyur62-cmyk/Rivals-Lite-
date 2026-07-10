let canvas;
let ctx;
let statusText;
let roomStatusText;
let hud;
let gameInfoText;
let playerInfoText;
let roomMode = 'local';

let WIDTH;
let HEIGHT;

const keys = {};
const mouse = { x: 0, y: 0 };
const lastShot = { p1: 0, p2: 0 };
let socket;
let roomCode = null;
let isHost = false;
let isConnected = false;
let customWebSocketHost = null;
let localPlayerId = 'p1';
let reconnectAttempts = 0;
let reconnectTimeout = null;
let lastConnectAttempt = 0;
let roomCodeInfoText;
let keepaliveInterval = null;
let roomJoined = false;
let lastRoomAction = null;
let useFirebase = false;
let firebaseApp = null;
let firebaseDb = null;
let firebaseListeners = [];
const maxReconnectDelay = 10; // seconds
const minReconnectDelay = 1000; // milliseconds
const KEEPALIVE_INTERVAL = 20000; // milliseconds
const DEFAULT_PUB_WS_HOST = 'localhost:8000';
const DEFAULT_DEV_WS_PORT = '7999';
const SCORE_LIMIT = 5;
const pendingSocketMessages = [];

function setCustomWebSocketHost(host) {
  customWebSocketHost = host ? host.trim() : null;
}

function getDefaultWebSocketHost() {
  const pageUrl = new URL(window.location.href);
  const host = pageUrl.hostname;
  const port = pageUrl.port;
  const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';

  if (isLocalHost) {
    return `localhost:${DEFAULT_DEV_WS_PORT}`;
  }
  return DEFAULT_PUB_WS_HOST;
}

function getWebSocketHost() {
  if (customWebSocketHost) {
    return customWebSocketHost;
  }
  const url = new URL(window.location.href);
  const queryHost = url.searchParams.get('wsHost') || url.searchParams.get('ws');
  if (queryHost) {
    return queryHost;
  }
  return getDefaultWebSocketHost();
}

function getWebSocketProtocol(host) {
  const isLocalHost = host.startsWith('localhost') || host.startsWith('127.') || host.startsWith('[::1]');
  if (isLocalHost) {
    return 'ws';
  }
  if (window.location.protocol === 'https:') {
    return 'wss';
  }
  return 'ws';
}

function startKeepalive() {
  stopKeepalive();
  keepaliveInterval = setInterval(() => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'ping' }));
    }
  }, KEEPALIVE_INTERVAL);
}

function stopKeepalive() {
  if (keepaliveInterval) {
    clearInterval(keepaliveInterval);
    keepaliveInterval = null;
  }
}

const weapons = {
  primary: {
    name: 'Cannon',
    fireRate: 0.08,
    bulletSpeed: 500,
    bulletSize: 6,
    damage: 20,
    color: '#64d9ff',
    reloadTime: 1.5,
  },
  secondary: {
    name: 'Rapid Pulse',
    fireRate: 0.25,
    bulletSpeed: 500,
    bulletSize: 8,
    damage: 7,
    color: '#ffb86c',
    reloadTime: 1.5,
  },
  knife: {
    name: 'Knife',
    fireRate: 3,
    damage: 35,
    backstabDamage: 50,
    color: '#d9b38c',
    range: 50,
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
    utility: 'grenade',
    utilityState: { cooldown: 0, charging: false, chargeStartedAt: 0, chargeDuration: 5 },
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
    utility: 'grenade',
    utilityState: { cooldown: 0, charging: false, chargeStartedAt: 0, chargeDuration: 5 },
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

  const applyInput = player.id === localPlayerId;
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

  const nextX = player.x + dx * player.speed * dt;
  const nextY = player.y + dy * player.speed * dt;
  const previousX = player.x;
  const previousY = player.y;

  if (pathIntersectsAnyWall(player.x, player.y, nextX, nextY, player.radius, walls)) {
    player.x = previousX;
    player.y = previousY;
  } else {
    player.x = nextX;
    player.y = nextY;
  }

  player.x = clamp(player.x, player.radius, WIDTH - player.radius);
  player.y = clamp(player.y, player.radius, HEIGHT - player.radius);
}

function pathIntersectsAnyWall(startX, startY, endX, endY, radius, wallList) {
  return wallList.some((wall) => pathIntersectsWall(startX, startY, endX, endY, radius, wall));
}

function pathIntersectsWall(startX, startY, endX, endY, radius, rect) {
  const expanded = {
    x: rect.x - radius,
    y: rect.y - radius,
    w: rect.w + radius * 2,
    h: rect.h + radius * 2,
  };
  return lineIntersectsRect(startX, startY, endX, endY, expanded);
}

function circleRectCollision(cx, cy, radius, rect) {
  const closestX = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const closestY = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy < radius * radius;
}

function shootWeapon(player) {
  const now = performance.now() / 1000;
  const shotKey = player.id;
  const config = weapons[player.weapon];

  if (!config) return;
  if (player.weapon === 'knife') {
    if (now - lastShot[shotKey] < config.fireRate) return;
    performKnifeAttack(player);
    lastShot[shotKey] = now;
    return;
  }

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

function performKnifeAttack(player) {
  const angle = Math.atan2(player.aimY - player.y, player.aimX - player.x);
  const attackRange = weapons.knife.range;
  const attackX = player.x + Math.cos(angle) * attackRange;
  const attackY = player.y + Math.sin(angle) * attackRange;

  for (const target of players) {
    if (target.id === player.id || target.health <= 0) continue;
    const dx = attackX - target.x;
    const dy = attackY - target.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= target.radius + 8) {
      const isBackstab = isBehindTarget(player, target);
      const damage = isBackstab ? weapons.knife.backstabDamage : weapons.knife.damage;
      target.health = Math.max(0, target.health - damage);
      target.lastDamageTime = performance.now() / 1000;
      break;
    }
  }
}

function isBehindTarget(attacker, target) {
  const attackAngle = Math.atan2(attacker.aimY - attacker.y, attacker.aimX - attacker.x);
  const targetAngle = Math.atan2(target.y - attacker.y, target.x - attacker.x);
  const delta = ((targetAngle - attackAngle + Math.PI) % (Math.PI * 2)) - Math.PI;
  return Math.abs(delta) < Math.PI / 4;
}

function cycleUtility(player) {
  if (!player) return;
  player.utility = player.utility === 'grenade' ? 'medkit' : 'grenade';
}

function useUtility(player) {
  if (!player) return;
  const state = player.utilityState || { cooldown: 0, charging: false, chargeStartedAt: 0, chargeDuration: 5 };
  player.utilityState = state;
  if (state.cooldown > 0 || state.charging) return;

  if (player.utility === 'medkit') {
    state.charging = true;
    state.chargeStartedAt = performance.now() / 1000;
    state.chargeDuration = 5;
    return;
  }

  if (player.utility === 'grenade') {
    throwGrenade(player);
    state.cooldown = 25;
  }
}

function throwGrenade(player) {
  const angle = Math.atan2(player.aimY - player.y, player.aimX - player.x);
  bullets.push({
    owner: player.id,
    type: 'grenade',
    x: player.x + Math.cos(angle) * player.radius,
    y: player.y + Math.sin(angle) * player.radius,
    vx: Math.cos(angle) * 260,
    vy: Math.sin(angle) * 260,
    lifetime: 1.2,
    size: 8,
    color: '#ff5a5a',
    damage: 50,
    radius: 90,
    previewX: player.x + Math.cos(angle) * 280,
    previewY: player.y + Math.sin(angle) * 280,
  });
}

function explodeGrenade(grenade) {
  for (const player of players) {
    if (player.id === grenade.owner || player.health <= 0) continue;
    const dx = grenade.x - player.x;
    const dy = grenade.y - player.y;
    if (Math.hypot(dx, dy) <= grenade.radius + player.radius) {
      player.health = Math.max(0, player.health - grenade.damage);
      player.lastDamageTime = performance.now() / 1000;
    }
  }
}

function updateUtilityStates(dt) {
  const now = performance.now() / 1000;
  for (const player of players) {
    const state = player.utilityState || { cooldown: 0, charging: false, chargeStartedAt: 0, chargeDuration: 5 };
    player.utilityState = state;
    if (state.cooldown > 0) {
      state.cooldown = Math.max(0, state.cooldown - dt);
    }
    if (state.charging && now - state.chargeStartedAt >= state.chargeDuration) {
      player.health = Math.min(150, player.health + 70);
      player.lastDamageTime = now;
      state.charging = false;
      state.cooldown = 30;
    }
  }
}

function updateBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.lifetime -= dt;

    const offscreen = b.x < -50 || b.x > WIDTH + 50 || b.y < -50 || b.y > HEIGHT + 50;
    if (offscreen || b.lifetime <= 0) {
      if (b.type === 'grenade') {
        explodeGrenade(b);
      }
      bullets.splice(i, 1);
      continue;
    }

    let removed = false;
    for (const wall of walls) {
      const prevX = b.x - b.vx * dt;
      const prevY = b.y - b.vy * dt;
      if (lineIntersectsRect(prevX, prevY, b.x, b.y, wall)) {
        if (b.type === 'grenade') {
          explodeGrenade(b);
        }
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

function goHome() {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.close();
  }
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  socket = null;
  roomCode = null;
  customWebSocketHost = null;
  isHost = false;
  localPlayerId = 'p1';
  reconnectAttempts = 0;
  roomJoined = false;
  lastRoomAction = null;
  roundOver = false;
  restartTimer = 0;
  scores.Blue = 0;
  scores.Red = 0;
  resetGame();

  const menu = document.getElementById('menu');
  const joinControls = document.getElementById('joinControls');
  const hud = document.getElementById('hud');
  if (menu) menu.style.display = 'block';
  if (joinControls) joinControls.style.display = 'none';
  if (hud) hud.style.display = 'none';
  if (roomStatusText) roomStatusText.textContent = 'Match complete. Return to the homepage to start again.';
  if (gameInfoText) gameInfoText.textContent = 'Not connected';
  if (playerInfoText) playerInfoText.textContent = '';
  // cleanup firebase listeners/presence if used
  if (useFirebase) {
    firebaseCleanup();
  }
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

    if (b.type === 'grenade') {
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 2;
      ctx.arc(b.previewX, b.previewY, 24, 0, Math.PI * 2);
      ctx.stroke();
    }
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

function lineIntersectsRect(ax, ay, bx, by, rect) {
  const left = rect.x;
  const right = rect.x + rect.w;
  const top = rect.y;
  const bottom = rect.y + rect.h;

  const intersects = (x1, y1, x2, y2, x3, y3, x4, y4) => {
    const s1x = x2 - x1;
    const s1y = y2 - y1;
    const s2x = x4 - x3;
    const s2y = y4 - y3;
    const s = ((x3 - x1) * s1y - (y3 - y1) * s1x) / (-s2x * s1y + s1x * s2y);
    const t = ((x3 - x1) * s1y - (y3 - y1) * s1x) / (-s2x * s1y + s1x * s2y);
    return s >= 0 && s <= 1 && t >= 0 && t <= 1;
  };

  return (
    intersects(ax, ay, bx, by, left, top, right, top) ||
    intersects(ax, ay, bx, by, right, top, right, bottom) ||
    intersects(ax, ay, bx, by, right, bottom, left, bottom) ||
    intersects(ax, ay, bx, by, left, bottom, left, top) ||
    pointInRect(ax, ay, rect) ||
    pointInRect(bx, by, rect)
  );
}

function pointInRect(x, y, rect) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
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
    const weaponName = weapons[player.weapon]?.name || player.weapon;
    const utilityName = player.utility === 'grenade' ? 'Grenade' : 'Medkit';
    return `${getTeamName(player)}: ${hp}/150 | ${weaponName} | ${utilityName}`;
  }).join(' / ');

  const alive = players.filter((player) => player.health > 0);
  if (alive.length === 1) {
    const winner = alive[0];
    const team = getTeamName(winner);
    statusText.innerHTML = `${team} (${winner.id.toUpperCase()}) wins!`;
    if (!roundOver) {
      scores[team] = (scores[team] || 0) + 1;
      roundOver = true;
      if (scores[team] >= SCORE_LIMIT) {
        goHome();
        return;
      }
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

/* Firebase RTDB support */
function initFirebaseFromObject(config) {
  try {
    if (!firebaseApp) {
      firebaseApp = firebase.initializeApp(config);
      firebaseDb = firebase.database();
    }
    return true;
  } catch (e) {
    console.error('Firebase init error', e);
    return false;
  }
}

function firebaseCreateRoom() {
  // generate 4-char hex code
  const code = Math.random().toString(16).slice(2, 6);
  const roomRef = firebaseDb.ref(`rooms/${code}`);
  const metaRef = roomRef.child('meta');
  metaRef.set({ created: Date.now(), backend: 'firebase' });
  const playersRef = roomRef.child('players');
  const myRef = playersRef.child('p1');
  myRef.set({ connected: true, ts: Date.now() });
  myRef.onDisconnect().remove();
  roomCode = code;
  roomJoined = true;
  isHost = true;
  localPlayerId = 'p1';
  roomStatusText.textContent = `Room created: ${roomCode}`;
  if (roomCodeInfoText) roomCodeInfoText.textContent = `Share this code with the other player: ${roomCode}`;
  setupFirebaseStateListeners(code);
}

function firebaseJoinRoom(code) {
  const roomRef = firebaseDb.ref(`rooms/${code}`);
  roomRef.child('meta').once('value').then((snap) => {
    if (!snap.exists()) {
      roomStatusText.textContent = 'Room not found';
      return;
    }
    const playersRef = roomRef.child('players');
    playersRef.once('value').then((ps) => {
      const count = ps.numChildren();
      if (count >= 2) {
        roomStatusText.textContent = 'Room full';
        return;
      }
      const myId = count === 0 ? 'p1' : 'p2';
      const myRef = playersRef.child(myId);
      myRef.set({ connected: true, ts: Date.now() });
      myRef.onDisconnect().remove();
      roomCode = code;
      roomJoined = true;
      isHost = myId === 'p1';
      localPlayerId = myId;
      roomStatusText.textContent = `Joined room: ${roomCode}`;
      if (roomCodeInfoText) roomCodeInfoText.textContent = `Connected to room ${roomCode}`;
      setupFirebaseStateListeners(code);
    });
  }).catch((err) => { roomStatusText.textContent = 'Error joining room'; console.error(err); });
}

function setupFirebaseStateListeners(code) {
  // listen for other player's state changes
  const stateRef = firebaseDb.ref(`rooms/${code}/state`);
  const childAdded = stateRef.on('child_added', (snap) => {
    const id = snap.key;
    if (id === localPlayerId) return;
    const payload = snap.val();
    applyRemoteState(id, payload);
  });
  const childChanged = stateRef.on('child_changed', (snap) => {
    const id = snap.key;
    if (id === localPlayerId) return;
    const payload = snap.val();
    applyRemoteState(id, payload);
  });
  firebaseListeners.push({ ref: stateRef, events: ['child_added', 'child_changed'] });
}

function firebaseSendState(payload) {
  if (!useFirebase || !roomJoined || !roomCode) return;
  try {
    const ref = firebaseDb.ref(`rooms/${roomCode}/state/${localPlayerId}`);
    ref.set(payload);
    ref.onDisconnect().remove();
  } catch (e) {
    console.warn('firebaseSendState err', e);
  }
}

function firebaseCleanup() {
  try {
    for (const l of firebaseListeners) {
      l.ref.off();
    }
    firebaseListeners.length = 0;
    if (roomCode && localPlayerId) {
      firebaseDb.ref(`rooms/${roomCode}/players/${localPlayerId}`).remove();
      firebaseDb.ref(`rooms/${roomCode}/state/${localPlayerId}`).remove();
    }
  } catch (e) {
    console.warn('firebase cleanup', e);
  }
  roomJoined = false;
  roomCode = null;
  useFirebase = false;
}

function applyRemoteState(id, payload) {
  // payload.players and payload.bullets expected
  if (!payload) return;
  const remote = players.find((p) => p.id === id);
  if (remote && payload.players && payload.players.length > 0) {
    const inc = payload.players[0];
    remote.x = inc.x;
    remote.y = inc.y;
    remote.aimX = inc.aimX;
    remote.aimY = inc.aimY;
    remote.weapon = inc.weapon;
    remote.health = inc.health;
    remote.utility = inc.utility || remote.utility;
    remote.utilityState = inc.utilityState || remote.utilityState;
  }
  if (payload.bullets) {
    bullets = bullets.filter((bullet) => bullet.owner !== id);
    bullets.push(...payload.bullets.map((b) => ({ ...b, owner: id })));
  }
}

function sendState() {
  // If using Firebase, push state there. Otherwise use WebSocket.
  if (useFirebase) {
    if (!firebaseDb || !roomJoined || !roomCode) return;
  } else {
    if (!socket || socket.readyState !== WebSocket.OPEN || !roomCode) return;
  }
  // send only local player's state and bullets owned by local player
  const local = players.find((p) => p.id === localPlayerId);
  if (!local) return;
  const payload = {
    players: [{ id: local.id, x: local.x, y: local.y, aimX: local.aimX, aimY: local.aimY, weapon: local.weapon, health: local.health, utility: local.utility, utilityState: local.utilityState }],
    bullets: bullets.filter((b) => b.owner === local.id),
  };
  if (useFirebase) {
    firebaseSendState(payload);
  } else {
    socket.send(JSON.stringify({ type: 'state', payload }));
  }
}

function loop(timestamp) {
  const dt = getDeltaTime(timestamp);
  players.forEach((player) => updatePlayer(player, dt));
  updateBullets(dt);
  regenerateHealth(dt);
  updateUtilityStates(dt);
  drawScene();

  // send state via the active transport (WebSocket or Firebase)
  sendState();

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
}

function connectSocket() {
  const now = Date.now();
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  if (now - lastConnectAttempt < minReconnectDelay) return;
  lastConnectAttempt = now;

  const host = getWebSocketHost();
  const protocol = getWebSocketProtocol(host);
  const wsUrl = `${protocol}://${host}`;
  roomStatusText.textContent = `Connecting to ${wsUrl}...`;
  socket = new WebSocket(wsUrl);

  socket.addEventListener('open', () => {
    isConnected = true;
    reconnectAttempts = 0;
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
    roomStatusText.textContent = 'Connected to server.';
    startKeepalive();

    const hadQueuedMessage = pendingSocketMessages.length > 0;
    if (hadQueuedMessage) {
      pendingSocketMessages.forEach((pending) => socket.send(JSON.stringify(pending)));
      pendingSocketMessages.length = 0;
    }

    if (!roomJoined && roomCode && localPlayerId && !hadQueuedMessage) {
      socket.send(JSON.stringify({ type: 'resume', code: roomCode, playerId: localPlayerId }));
    } else if (!roomJoined && lastRoomAction && !hadQueuedMessage) {
      socket.send(JSON.stringify(lastRoomAction));
    }
  });

  socket.addEventListener('error', (err) => {
    console.warn('WebSocket error', err);
    roomStatusText.textContent = 'WebSocket error';
  });

  socket.addEventListener('message', (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'created') {
      roomCode = data.code;
      roomJoined = true;
      isHost = true;
      roomStatusText.textContent = `Room created: ${roomCode}`;
      if (roomCodeInfoText) {
        roomCodeInfoText.textContent = `Share this code with the other player: ${roomCode}`;
      }
      localPlayerId = data.playerId || 'p1';
      lastRoomAction = { type: 'create' };
    }
    if (data.type === 'joined' || data.type === 'rejoined') {
      roomCode = data.code;
      roomJoined = true;
      isHost = data.playerId === 'p1';
      roomStatusText.textContent = `Joined room: ${roomCode}`;
      if (roomCodeInfoText) {
        roomCodeInfoText.textContent = `Connected to room ${roomCode}`;
      }
      localPlayerId = data.playerId || 'p2';
      if (!lastRoomAction) {
        lastRoomAction = { type: 'join', code: data.code };
      }
    }
    if (data.type === 'roomReady') {
      roomStatusText.textContent = `Room ready: ${data.code}`;
      if (roomCodeInfoText) {
        roomCodeInfoText.textContent = `Game ready! Room code: ${data.code}`;
      }
    }
    if (data.type === 'pong') {
      // Application-level heartbeat response.
      return;
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
    roomJoined = false;
    roomStatusText.textContent = 'Disconnected from server.';
    socket = null;
    stopKeepalive();
    // attempt reconnect with backoff
    reconnectAttempts = Math.min(reconnectAttempts + 1, 10);
    const delay = Math.min(maxReconnectDelay, Math.pow(2, reconnectAttempts)) * 1000;
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
    }
    reconnectTimeout = setTimeout(() => {
      roomStatusText.textContent = `Reconnecting... (attempt ${reconnectAttempts})`;
      connectSocket();
    }, delay);
  });
}

function setRoomMode(mode) {
  roomMode = mode;
  const roomControls = document.getElementById('roomControls');
  if (roomControls) {
    roomControls.textContent = mode === 'firebase' ? 'Firebase room mode' : 'Online room mode';
  }
}

function initUI() {
  statusText = document.getElementById('status');
  roomStatusText = document.getElementById('roomStatus');
  roomCodeInfoText = document.getElementById('roomCodeInfo');
  hud = document.getElementById('hud');
  gameInfoText = document.getElementById('gameInfo');
  playerInfoText = document.getElementById('playerInfo');

  const menu = document.getElementById('menu');
  const createRoomBtn = document.getElementById('createRoom');
  const showJoinBtn = document.getElementById('showJoin');
  const joinControls = document.getElementById('joinControls');
  const roomCodeInput = document.getElementById('roomCode');
  const serverHostInput = document.getElementById('serverHost');
  const joinRoomBtn = document.getElementById('joinRoom');
  const firebaseConfigInput = document.getElementById('firebaseConfig');
  const useFirebaseBtn = document.getElementById('useFirebase');
  const firebaseStatus = document.getElementById('firebaseStatus');
  const roomControls = document.getElementById('roomControls');

  joinControls.style.display = 'none';
  hud.style.display = 'none';

  function sendSocketMessage(message) {
    if (message.type === 'create' || message.type === 'join') {
      lastRoomAction = message;
    }

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      pendingSocketMessages.push(message);
      connectSocket();
      return;
    }
    socket.send(JSON.stringify(message));
  }

  createRoomBtn.addEventListener('click', () => {
    if (useFirebase) {
      setRoomMode('firebase');
      firebaseCreateRoom();
      menu.style.display = 'none';
      hud.style.display = 'block';
      return;
    }
    setRoomMode('online');
    lastRoomAction = { type: 'create' };
    sendSocketMessage(lastRoomAction);
    menu.style.display = 'none';
    hud.style.display = 'block';
  });

  showJoinBtn.addEventListener('click', () => {
    joinControls.style.display = 'block';
  });

  joinRoomBtn.addEventListener('click', () => {
    const code = roomCodeInput.value.trim();
    const host = serverHostInput.value.trim();
    setCustomWebSocketHost(host);
    if (!code) {
      roomStatusText.textContent = 'Enter a join code.';
      return;
    }
    if (useFirebase) {
      setRoomMode('firebase');
      firebaseJoinRoom(code);
      menu.style.display = 'none';
      hud.style.display = 'block';
      return;
    }
    setRoomMode('online');
    lastRoomAction = { type: 'join', code };
    sendSocketMessage(lastRoomAction);
    menu.style.display = 'none';
    hud.style.display = 'block';
  });

  if (useFirebaseBtn) {
    useFirebaseBtn.addEventListener('click', () => {
      const raw = firebaseConfigInput.value.trim();
      if (!raw) {
        if (firebaseStatus) firebaseStatus.textContent = 'Paste Firebase config JSON first.';
        return;
      }
      try {
        const cfg = JSON.parse(raw);
        const ok = initFirebaseFromObject(cfg);
        if (ok) {
          useFirebase = true;
          setRoomMode('firebase');
          if (firebaseStatus) firebaseStatus.textContent = 'Firebase ready';
        } else {
          if (firebaseStatus) firebaseStatus.textContent = 'Firebase init failed';
        }
      } catch (e) {
        if (firebaseStatus) firebaseStatus.textContent = 'Invalid JSON';
      }
    });
  }
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
    if (!isInputFocused && ['w', 'a', 's', 'd', ' ', 'e', 'p', 'o', 'q', 'r', 'f'].includes(key)) {
      event.preventDefault();
    }

    if (!isInputFocused) {
      setMovementKey(key, true);
      const local = players.find((p) => p.id === localPlayerId) || players[0];
      if (key === 'e' || key === 'p') {
        local.weapon = local.weapon === 'primary' ? 'secondary' : local.weapon === 'secondary' ? 'knife' : 'primary';
      }
      if (key === 'q' || key === 'r') {
        cycleUtility(local);
      }
      if (key === 'f') {
        useUtility(local);
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

  if (roomControls) {
    roomControls.textContent = 'Local play';
  }

  canvas.addEventListener('contextmenu', (event) => {
    event.preventDefault();
  });

  window.addEventListener('blur', () => {
    Object.keys(keys).forEach((key) => {
      keys[key] = false;
    });
  });

  requestAnimationFrame(loop);
  // Auto-connect only on localhost (dev). Public pages should not auto-connect
  // to a private dev port — users must enter a server host first.
  const pageUrl = new URL(window.location.href);
  const pageHost = pageUrl.hostname;
  const isLocalHost = pageHost === 'localhost' || pageHost === '127.0.0.1' || pageHost === '[::1]';
  if (isLocalHost) {
    connectSocket();
  }
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
