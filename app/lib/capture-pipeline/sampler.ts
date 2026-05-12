import type { Frame } from "@spectrum-design-lab/shared";
import { DEFAULT_PIPELINE } from "@spectrum-design-lab/shared";
import type { ProcessingContext } from "./types";

export type SampleOptions = {
  totalFrames?: number;
  selectedCount?: number;
};

function findClosest(frames: Frame[], target: number): Frame | undefined {
  let best: Frame | undefined;
  let bestDist = Infinity;
  for (const frame of frames) {
    const dist = Math.abs(frame.index - target);
    if (dist < bestDist) {
      bestDist = dist;
      best = frame;
    }
  }
  return best;
}

/**
 * Select evenly-spaced frames from the full set.
 * E.g. pick 72 from 360 → every 5th frame.
 */
export function sampleFrames(
  _ctx: ProcessingContext,
  frames: Frame[],
  opts: SampleOptions = {},
): Frame[] {
  const totalFrames = opts.totalFrames ?? DEFAULT_PIPELINE.totalFrames;
  const selectedCount = opts.selectedCount ?? DEFAULT_PIPELINE.selectedFrames;

  if (frames.length === 0) return [];
  if (frames.length <= selectedCount) return [...frames];

  const byIndex = new Map<number, Frame>();
  for (const frame of frames) {
    byIndex.set(frame.index, frame);
  }

  const step = totalFrames / selectedCount;
  const selected: Frame[] = [];

  for (let i = 0; i < selectedCount; i++) {
    const targetIndex = Math.round(1 + i * step);
    const frame = byIndex.get(targetIndex) ?? findClosest(frames, targetIndex);
    if (frame) {
      selected.push(frame);
    }
  }

  return selected;
}
