import { v } from "convex/values";

/**
 * Stable ids for the bundled projector textures in `public/backgrounds`.
 * Question position picks one when the host has not chosen yet, so each
 * question in a deck starts on a different texture.
 */
export const BACKGROUND_PRESETS = [
  "rose-glow",
  "color-wash",
  "liquid-violet",
  "paint-pour",
  "neon-bloom",
  "mesh-sunset",
] as const;

export type BackgroundPreset = (typeof BACKGROUND_PRESETS)[number];

export const backgroundPresetValidator = v.union(
  v.literal("rose-glow"),
  v.literal("color-wash"),
  v.literal("liquid-violet"),
  v.literal("paint-pour"),
  v.literal("neon-bloom"),
  v.literal("mesh-sunset"),
);

export function presetForPosition(position: number): BackgroundPreset {
  const count = BACKGROUND_PRESETS.length;
  const index = ((position % count) + count) % count;
  return BACKGROUND_PRESETS[index];
}
