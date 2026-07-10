const test = require('node:test');
const assert = require('node:assert/strict');
const { weaponConfigs, cycleWeapon, getWeaponDamage, resolvePlayerWallCollision, bulletHitsWall } = require('../game-logic');

test('knife uses the requested backstab damage', () => {
  assert.equal(getWeaponDamage('knife'), 35);
  assert.equal(getWeaponDamage('knife', true), 50);
});

test('weapon cycling includes melee and wraps around', () => {
  assert.equal(cycleWeapon('primary'), 'secondary');
  assert.equal(cycleWeapon('secondary'), 'knife');
  assert.equal(cycleWeapon('knife'), 'primary');
});

test('player movement is blocked by walls and bullets stop at walls', () => {
  const walls = [{ x: 100, y: 100, w: 50, h: 50 }];
  const player = { x: 60, y: 60, radius: 10 };
  resolvePlayerWallCollision(player, 120, 120, walls);
  assert.equal(player.x, 60);
  assert.equal(player.y, 60);

  assert.equal(bulletHitsWall(90, 90, 150, 90, walls[0]), false);
  assert.equal(bulletHitsWall(90, 90, 120, 120, walls[0]), true);
});
