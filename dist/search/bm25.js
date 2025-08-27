function tokenize(text) {
    return text
        .toLowerCase()
        .replace(/[^a-zA-Z0-9а-яА-ЯёЁ\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
}
export function bm25Search(corpus, query, options) {
    const k1 = options?.k1 ?? 1.5;
    const b = options?.b ?? 0.75;
    const limit = options?.limit ?? 20;
    const docs = corpus.map((d) => ({ ...d, tokens: tokenize(d.text) }));
    const N = docs.length || 1;
    const avgdl = docs.reduce((s, d) => s + d.tokens.length, 0) / N;
    const df = new Map();
    for (const d of docs) {
        const seen = new Set();
        for (const t of d.tokens) {
            if (seen.has(t))
                continue;
            seen.add(t);
            df.set(t, (df.get(t) ?? 0) + 1);
        }
    }
    const qTokens = Array.from(new Set(tokenize(query)));
    const results = [];
    for (const d of docs) {
        let score = 0;
        const dl = d.tokens.length;
        const tf = new Map();
        for (const t of d.tokens)
            tf.set(t, (tf.get(t) ?? 0) + 1);
        for (const q of qTokens) {
            const f = tf.get(q) ?? 0;
            if (f === 0)
                continue;
            const n_q = df.get(q) ?? 0.5;
            const idf = Math.log(1 + (N - n_q + 0.5) / (n_q + 0.5));
            const denom = f + k1 * (1 - b + (b * dl) / avgdl);
            score += idf * ((f * (k1 + 1)) / denom);
        }
        if (score > 0)
            results.push({ id: d.id, score, item: d.item });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
}
