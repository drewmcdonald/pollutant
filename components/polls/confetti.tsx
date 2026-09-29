"use client";

import { useEffect, useRef } from "react";

const COLORS = [
  "#fbbf24",
  "#fb7185",
  "#22d3ee",
  "#f9a8d4",
  "#ffffff",
  "#c4b5fd",
  "#fb923c",
];

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  rotation: number;
  spin: number;
  tilt: number;
};

function burst(width: number, height: number): Particle[] {
  const particles: Particle[] = [];
  for (const origin of [0.18, 0.5, 0.82]) {
    for (let index = 0; index < 70; index++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.95;
      const speed = 8 + Math.random() * 11;
      particles.push({
        x: width * origin,
        y: height * 0.32,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 6 + Math.random() * 8,
        color: COLORS[index % COLORS.length],
        rotation: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.28,
        tilt: 0.35 + Math.random() * 0.65,
      });
    }
  }
  return particles;
}

/** Full-screen confetti. Plays once each time `play` becomes true. */
export function Confetti({ play }: { play: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!play) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;
    let context: CanvasRenderingContext2D | null;
    try {
      context = canvas.getContext("2d");
    } catch {
      return;
    }
    if (!context) return;

    const fit = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit();

    const particles = burst(window.innerWidth, window.innerHeight);
    const started = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const elapsed = now - started;
      context.clearRect(0, 0, width, height);
      context.globalAlpha = Math.max(0, 1 - elapsed / 4600);
      for (const particle of particles) {
        particle.vy += 0.16;
        particle.vx *= 0.994;
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.rotation += particle.spin;
        context.save();
        context.translate(particle.x, particle.y);
        context.rotate(particle.rotation);
        context.fillStyle = particle.color;
        context.fillRect(
          -particle.size / 2,
          (-particle.size * particle.tilt) / 2,
          particle.size,
          particle.size * particle.tilt,
        );
        context.restore();
      }
      if (elapsed < 4800) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    window.addEventListener("resize", fit);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", fit);
    };
  }, [play]);

  if (!play) return null;
  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-50"
      aria-hidden
    />
  );
}
