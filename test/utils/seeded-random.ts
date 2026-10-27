/**
 * A deterministic generator, so a failure in a randomized check is
 * reproducible from the seed rather than from the run. xorshift32.
 *
 * Shared by the row stream's randomized check (issue #336) and the observer's
 * (issue #345), which measure the same property at two levels: that what the
 * consumer holds equals a read of the store, whatever order the facts arrived
 * in and whichever batches they came in.
 */
export function seededRandom(seed: number): () => number {
    let state = seed >>> 0 || 1;
    return () => {
        state ^= state << 13; state >>>= 0;
        state ^= state >>> 17;
        state ^= state << 5; state >>>= 0;
        return state / 0x100000000;
    };
}

export function shuffled<T>(items: T[], random: () => number): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}
