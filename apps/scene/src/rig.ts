/**
 * Where the rig hangs. One list, used by the world (the trusses and lamp housings
 * you see) and by the lights and lasers (what they fire from), so every fixture
 * sits on a piece of structure instead of floating in the sky.
 *
 * Stage (seen from the crowd camera, the "back" view):
 *   - roof truss across the top at y 33.2-34, z -15, from tower to tower
 *   - two side towers at x +/-45, floor to roof
 * Front of house (seen from the DJ's camera):
 *   - a crossbar on top of the two side-screen poles at z 46, with outer towers at x +/-40
 *   - a low delay truss far out in the crowd at z 100
 */

/** Stage roof truss and side towers. */
export const ROOF = { x: 45.6, y0: 33.2, y1: 34, z: -15 };
export const TOWER_X = 45;
/** Front-of-house crossbar (on the poles) and its outer towers. */
export const FOH = { x: 40.6, y0: 21.6, y1: 22.6, z: 46, towerX: 40 };
/** Delay truss out in the crowd for the DJ's-view moving heads. */
export const DELAY = { x: 72, y0: 7.4, y1: 8.2, z: 100 };

/** A blinder pod: two lamps side by side (or stacked, on the sides). */
export interface Pod { x: number; y: number; z: number; vertical: boolean }

/** Blinders all around the main screen: along the roof truss, up both sides of the frame, and on the stage floor. */
export const BLINDERS_BACK: Pod[] = [
  ...[-24, -16, -8, 0, 8, 16, 24].map((x) => ({ x, y: 33.6, z: -14.6, vertical: false })),
  ...[6, 12, 18, 24, 30].flatMap((y) => [-1, 1].map((s) => ({ x: s * 27.35, y, z: -16.7, vertical: true }))),
  ...[-20, -10, 0, 10, 20].map((x) => ({ x, y: 2.35, z: -16.2, vertical: false })),
];
/** Front of house: under the crossbar and up its towers. */
export const BLINDERS_FRONT: Pod[] = [
  ...[-32, -20, -8, 8, 20, 32].map((x) => ({ x, y: 21, z: 45.8, vertical: false })),
  ...[9, 15].flatMap((y) => [-1, 1].map((s) => ({ x: s * FOH.towerX, y, z: 45.4, vertical: true }))),
];
/** The two lamps in a pod. */
export const podLamps = (p: Pod): number[][] =>
  p.vertical ? [[p.x, p.y - 0.6, p.z], [p.x, p.y + 0.6, p.z]] : [[p.x - 0.6, p.y, p.z], [p.x + 0.6, p.y, p.z]];

/** Moving heads: on the roof truss (stage) or the delay truss (front of house). */
export const HEAD_Y = { roofUp: 34.3, roofDown: 32.8, delay: 7 };
