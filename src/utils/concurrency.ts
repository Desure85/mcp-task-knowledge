/**
 * utils/concurrency.ts — ограниченный параллелизм для файловых обходов.
 *
 * `listTasks`/`listDocs` исторически читали файлы строго последовательно (`await` в `for`),
 * из-за чего время росло линейно с N при полном отсутствии использования дискового
 * параллелизма: 100k задач = 4.3 с даже на тёплом кэше (docs/benchmarks/scale-2026-10.md §3.1).
 *
 * Пул сохраняет порядок результатов и не поднимает больше `limit` файловых дескрипторов
 * одновременно (защита от EMFILE на больших каталогах).
 */

/** Предел одновременных файловых операций по умолчанию. */
export const DEFAULT_IO_CONCURRENCY = 32;

/**
 * Применяет `fn` к элементам с ограничением параллелизма, сохраняя порядок результата.
 * Первая ошибка прерывает выполнение (поведение то же, что у последовательного цикла).
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const size = Math.max(1, Math.trunc(limit) || 1);
  const results = new Array<R>(items.length);
  let next = 0;
  let failed: { error: unknown } | null = null;

  const worker = async (): Promise<void> => {
    while (true) {
      if (failed) return;
      const index = next++;
      if (index >= items.length) return;
      try {
        results[index] = await fn(items[index], index);
      } catch (error) {
        failed = { error };
        return;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(size, items.length) }, () => worker()));
  if (failed) throw (failed as { error: unknown }).error;
  return results;
}
