export function pickWithEpsilonGreedy(variants, stats, params) {
    const eps = params?.epsilon ?? 0.1;
    if (variants.length === 0)
        throw new Error('No variants to pick from');
    // Explore
    if (Math.random() < eps) {
        return variants[Math.floor(Math.random() * variants.length)];
    }
    // Exploit: choose best by average score (fallback to success rate; fallback to random)
    let best = variants[0];
    let bestScore = -Infinity;
    for (const v of variants) {
        const s = stats[v];
        let metric = 0;
        if (s && s.trials > 0) {
            const avgScore = s.scoreSum / s.trials;
            const successRate = s.successes / s.trials;
            // Weighted blend: prioritize score when present, otherwise successRate
            metric = Number.isFinite(avgScore) && avgScore > 0 ? avgScore : successRate;
        }
        else {
            // unseen -> small prior to avoid starving
            metric = 0.5;
        }
        if (metric > bestScore) {
            bestScore = metric;
            best = v;
        }
    }
    return best;
}
