import {
  presetForPosition,
  type BackgroundPreset,
} from "@/convex/lib/backgrounds";

/**
 * High-resolution Unsplash photos, downloaded into `public/backgrounds`
 * (Unsplash License). Each question on the projector uses one of these
 * unless the host uploads a replacement.
 *
 * - rose-glow: photo-1550684848-fac1c5b4e853
 * - color-wash: photo-1579546929518-9e396f3cc809
 * - liquid-violet: photo-1618005182384-a83a8bd57fbe
 * - paint-pour: photo-1557672172-298e090bd0f1
 * - neon-bloom: photo-1541701494587-cb58502866ab
 * - mesh-sunset: photo-1620641788421-7a1c342ea42e
 */
export const PROJECTOR_BACKGROUNDS: {
  id: BackgroundPreset;
  label: string;
  src: string;
}[] = [
  { id: "rose-glow", label: "Rose glow", src: "/backgrounds/rose-glow.jpg" },
  { id: "color-wash", label: "Color wash", src: "/backgrounds/color-wash.jpg" },
  {
    id: "liquid-violet",
    label: "Liquid violet",
    src: "/backgrounds/liquid-violet.jpg",
  },
  { id: "paint-pour", label: "Paint pour", src: "/backgrounds/paint-pour.jpg" },
  { id: "neon-bloom", label: "Neon bloom", src: "/backgrounds/neon-bloom.jpg" },
  {
    id: "mesh-sunset",
    label: "Mesh sunset",
    src: "/backgrounds/mesh-sunset.jpg",
  },
];

export function projectorBackgroundSrc(
  preset: BackgroundPreset | null | undefined,
  position: number,
  customUrl: string | null | undefined,
): string {
  if (customUrl) return customUrl;
  const id = preset ?? presetForPosition(position);
  return (
    PROJECTOR_BACKGROUNDS.find((background) => background.id === id)?.src ??
    PROJECTOR_BACKGROUNDS[0].src
  );
}

export { presetForPosition, type BackgroundPreset };
