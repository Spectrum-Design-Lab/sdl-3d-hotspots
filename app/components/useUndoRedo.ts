/**
 * Generic undo/redo hook for state management.
 * Maintains a history stack of snapshots with configurable max depth.
 */
import { useCallback, useRef, useState } from "react";

interface UndoRedoOptions {
  /** Maximum number of history entries (default: 50) */
  maxHistory?: number;
}

interface UndoRedoResult<T> {
  /** Current state value */
  value: T;
  /** Update state and push to history */
  setValue: (next: T | ((prev: T) => T)) => void;
  /** Undo to previous state. Returns true if undo was applied. */
  undo: () => boolean;
  /** Redo to next state. Returns true if redo was applied. */
  redo: () => boolean;
  /** Whether undo is available */
  canUndo: boolean;
  /** Whether redo is available */
  canRedo: boolean;
  /** Reset history (e.g. when loading a new product) */
  resetHistory: (newValue: T) => void;
}

export function useUndoRedo<T>(
  initialValue: T,
  options?: UndoRedoOptions,
): UndoRedoResult<T> {
  const maxHistory = options?.maxHistory ?? 50;

  // Use refs for history to avoid re-renders on every push
  const historyRef = useRef<T[]>([initialValue]);
  const indexRef = useRef(0);

  const [value, setValueInternal] = useState<T>(initialValue);
  // Counter to force re-render for canUndo/canRedo
  const [, setTick] = useState(0);

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValueInternal((prev) => {
        const resolved = typeof next === "function" ? (next as (p: T) => T)(prev) : next;

        // Truncate any redo history beyond current index
        const history = historyRef.current;
        const idx = indexRef.current;
        historyRef.current = history.slice(0, idx + 1);

        // Push new state
        historyRef.current.push(resolved);

        // Trim if exceeding max
        if (historyRef.current.length > maxHistory) {
          historyRef.current = historyRef.current.slice(-maxHistory);
        }

        indexRef.current = historyRef.current.length - 1;
        setTick((t) => t + 1);

        return resolved;
      });
    },
    [maxHistory],
  );

  const undo = useCallback(() => {
    if (indexRef.current <= 0) return false;
    indexRef.current -= 1;
    const restored = historyRef.current[indexRef.current];
    setValueInternal(restored);
    setTick((t) => t + 1);
    return true;
  }, []);

  const redo = useCallback(() => {
    if (indexRef.current >= historyRef.current.length - 1) return false;
    indexRef.current += 1;
    const restored = historyRef.current[indexRef.current];
    setValueInternal(restored);
    setTick((t) => t + 1);
    return true;
  }, []);

  const resetHistory = useCallback((newValue: T) => {
    historyRef.current = [newValue];
    indexRef.current = 0;
    setValueInternal(newValue);
    setTick((t) => t + 1);
  }, []);

  const canUndo = indexRef.current > 0;
  const canRedo = indexRef.current < historyRef.current.length - 1;

  return { value, setValue, undo, redo, canUndo, canRedo, resetHistory };
}
