"use client";
import { useEffect, useRef } from "react";
import type { Level } from "@/schema/level";
import type { Hooks } from "./hooks";

export default function Game({ level, onReady }: { level: Level; onReady?: (h: Hooks) => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let game: Phaser.Game | null = null, cancelled = false;
    (async () => {
      const P = (await import("phaser")).default;
      const { makeGame } = await import("./scene");
      if (cancelled || !box.current) return;
      const made = makeGame(P, box.current, level);
      game = made.game;
      if (process.env.NODE_ENV !== "production") {
        const w = window as unknown as { __pw?: unknown };
        made.hooks.onTick(s => { w.__pw = s; });
      }
      onReady?.(made.hooks);
    })();
    return () => { cancelled = true; game?.destroy(true); };
  }, [level, onReady]);
  return <div ref={box} style={{ width: "100%", height: "100%" }} />;
}
