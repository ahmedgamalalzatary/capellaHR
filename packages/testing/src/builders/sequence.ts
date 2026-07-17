/**
 * Monotonic integer sequence for test data, e.g. employee codes that must
 * continue after the highest existing code.
 */
export function createSequence(seed = 0): () => number {
  let current = seed;
  return () => {
    current += 1;
    return current;
  };
}
