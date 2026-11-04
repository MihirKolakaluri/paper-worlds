import { Level } from "@/schema/level";

// Real drawings with their levels already built, so Try it now needs no camera, paper or AI call.
export const SAMPLES = [
  { id: "a", name: "First drawing" },
  { id: "b", name: "Lava run" },
] as const;

export const sampleById = (id: string | null) => SAMPLES.find(s => s.id === id) ?? SAMPLES[0];

export async function loadSample(id: string): Promise<Level> {
  const res = await fetch(`/samples/${id}.json`);
  if (!res.ok) throw new Error(`sample ${id}: ${res.status}`);
  return Level.parse(await res.json());
}
