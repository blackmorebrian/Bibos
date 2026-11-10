/** Bibo customization presets. Order matters: indices are stored per viewer. */
export const HEADS = ['cat', 'dog', 'frog', 'moth', 'cactus', 'ghost', 'toaster', 'gremlin'] as const;
export const HATS = ['none', 'flowers', 'bow', 'party', 'bucket', 'crown', 'phones', 'mohawk', 'swoop', 'horns'] as const;
export const EXTRAS = ['none', 'hearts', 'kandi', 'shades', 'paint', 'spikes'] as const;
export const PATTERNS = ['plain', 'stripe', 'bolt'] as const;

export type HeadId = (typeof HEADS)[number];
export type HatId = (typeof HATS)[number];
export type ExtraId = (typeof EXTRAS)[number];

export const BODY_COLORS = ['#2fd16b', '#ff7a2f', '#ff5fa8', '#35c8ff', '#b983ff', '#ffd23f', '#ef4545', '#23c9a9'];
export const SHIRT_COLORS = ['#ff3d81', '#2b7bff', '#ffc21a', '#ffffff', '#14b8a6', '#7c3aed'];
/** Names viewers type in chat, same order as the color arrays. */
export const BODY_COLOR_NAMES = ['green', 'orange', 'pink', 'blue', 'purple', 'yellow', 'red', 'teal'] as const;
export const SHIRT_COLOR_NAMES = ['pink', 'blue', 'yellow', 'white', 'teal', 'purple'] as const;
/** Shirt index whose pattern accent switches to pink (white shirt). */
export const WHITE_SHIRT = 3;

/** Head-space y of the hat anchor, per head (paper units, canvas y-down). */
export const HEAD_TOP: Record<HeadId, number> = {
  cat: -0.38, dog: -0.42, frog: -0.5, moth: -0.42, cactus: -0.5, ghost: -0.48, toaster: -0.32, gremlin: -0.38,
};
export const EYE_Y: Record<HeadId, number> = {
  cat: -0.03, dog: -0.1, frog: -0.36, moth: -0.06, cactus: -0.1, ghost: -0.08, toaster: -0.04, gremlin: -0.05,
};
export const EYE_X: Record<HeadId, number> = {
  cat: 0.21, dog: 0.19, frog: 0.28, moth: 0.2, cactus: 0.14, ghost: 0.17, toaster: 0.2, gremlin: 0.2,
};

export interface BiboLook {
  head: number; // index into HEADS
  hat: number; // index into HATS
  extra: number; // index into EXTRAS
  color: number; // index into BODY_COLORS
  shirt: number; // index into SHIRT_COLORS
  pattern: number; // index into PATTERNS
}

/** Viewer actions. Index + 1 is the action id used on the wire and in shaders (0 = none). */
export const ACTIONS = ['clap', 'phone', 'lighter', 'jump', 'dance', 'flag'] as const;
export type ActionId = (typeof ACTIONS)[number];
export const ACTION_DURATION: Record<ActionId, number> = { clap: 4.5, phone: 8, lighter: 8, jump: 2.6, dance: 7, flag: 9 };
/** Numeric codes shared with the crowd shader. */
export const EM = { none: 0, clap: 1, phone: 2, lighter: 3, jump: 4, dance: 5, flag: 6, pump: 7 } as const;

/** Placeholder emotes (the real build uses the channel's Twitch emotes). */
export const PLACEHOLDER_EMOTES = ['heart', 'fire', 'skull', 'star', 'laugh', 'w'] as const;
