// Post-batch generation pipeline. For every unique marked word: ask DeepSeek
// for a definition, save it locally as a learning note (vocab + batchId), then
// push it to Eudic. Eudic failure is non-fatal and surfaced per word. Progress
// streams to the review window via onProgress so glosses fill in live.

import { extractContext } from "../lookup/capture.js";

const CONCURRENCY = 3;

// Minimal promise pool: N workers pull from a shared cursor.
async function pool(items, n, worker) {
  let i = 0;
  const runners = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
}

// Collect first-occurrence of each word (case-insensitive) with the block text
// to use as its lookup context.
function uniqueWords(blocks) {
  const seen = new Map();
  for (const block of blocks) {
    for (const m of block.marks) {
      const key = m.word.toLowerCase();
      if (!seen.has(key)) seen.set(key, { word: m.word, blockText: block.text });
    }
  }
  return [...seen.values()];
}

// Fill marks[].vocabId in-place from the results map (keyed by lowercased word).
function fillVocabIds(blocks, results) {
  for (const block of blocks) {
    for (const m of block.marks) {
      const r = results.get(m.word.toLowerCase());
      if (r && r.vocabId != null) m.vocabId = r.vocabId;
    }
  }
}

// runBatch resolves to a Map<lowerWord, { parsed, vocabId, eudicOk, ctx }>.
// deps: { lookupWord, appendVocab, saveToEudic, updateBatch }
export async function runBatch({ batchId, blocks, bookId, bookName, deps, onProgress }) {
  const words = uniqueWords(blocks);
  const total = words.length;
  const results = new Map();
  let done = 0;

  await pool(words, CONCURRENCY, async ({ word, blockText }) => {
    const ctx = extractContext(blockText, word);
    let parsed = { meaning: "查询失败" };
    let vocabId = null;
    let eudicOk = false;

    try {
      const resp = await deps.lookupWord({ word, context: ctx });
      if (resp?.ok) {
        parsed = resp.parsed;
        vocabId = await deps.appendVocab({
          word,
          meaning: parsed.meaning,
          in_context: parsed.in_context,
          type: parsed.type,
          note: parsed.note,
          context: ctx,
          sourceBookId: bookId,
          sourceBookName: bookName,
          batchId,
        });
        try {
          const eudicResp = await deps.saveToEudic({
            word,
            meaning: parsed.meaning,
            in_context: parsed.in_context,
            type: parsed.type,
            note: parsed.note,
            context: ctx,
          });
          eudicOk = !!eudicResp?.ok;
        } catch {
          eudicOk = false;
        }
      } else {
        parsed = { meaning: resp?.error || "查询失败" };
      }
    } catch (err) {
      parsed = { meaning: `查询失败: ${err?.message || err}` };
    }

    results.set(word.toLowerCase(), { parsed, vocabId, eudicOk, ctx });
    onProgress?.(++done, total, word, { parsed, vocabId, eudicOk, ctx });
  });

  fillVocabIds(blocks, results);
  await deps.updateBatch(batchId, { finishedAt: new Date().toISOString(), blocks });
  return results;
}
