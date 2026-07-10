export const WEAPON_ORDER = ['primary', 'secondary', 'knife'];

export const weaponConfigs = {
  primary: {
    name: 'Rapid Pulse',
    cooldown: 0.08,
    bulletSpeed: 500,
    bulletSize: 4,
    damage: 20,
    color: '#64d9ff',
    reloadTime: 1.5,
  },
  secondary: {
    name: 'Impact Rocket',
    cooldown: 0.5,
    bulletSpeed: 500,
    bulletSize: 12,
    damage: 7,
    color: '#ffb86c',
    reloadTime: 1.5,
  },
  knife: {
    name: 'Knife',
    cooldown: 3,
    damage: 35,
    backstabDamage: 50,
    range: 50,
    color: '#d9b38c',
  },
};

export function cycleWeapon(currentWeapon) {
  const index = WEAPON_ORDER.indexOf(currentWeapon);
  const nextIndex = index === -1 ? 0 : (index + 1) % WEAPON_ORDER.length;
  return WEAPON_ORDER[nextIndex];
}

export function getWeaponDamage(weaponKey, isBackstab = false) {
  const config = weaponConfigs[weaponKey];
  if (!config) return 0;
  return isBackstab ? config.backstabDamage ?? config.damage : config.damage;
}

export function resolvePlayerWallCollision(player, nextX, nextY, walls) {
  const previousX = player.x;
  const previousY = player.y;

  player.x = nextX;
  player.y = nextY;
  if (isCollidingWithWalls(player, walls)) {
    player.x = previousX;
    player.y = previousY;
  }

  return { x: player.x, y: player.y };
}

export function bulletHitsWall(previousX, previousY, nextX, nextY, wall) {
  return lineIntersectsRect(previousX, previousY, nextX, nextY, wall);
}

function isCollidingWithWalls(player, walls) {
  return walls.some((wall) => circleRectCollision(player.x, player.y, player.radius, wall));
}

function circleRectCollision(cx, cy, radius, rect) {
  const closestX = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const closestY = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy < radius * radius;
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
