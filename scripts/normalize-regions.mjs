#!/usr/bin/env node
// Rewrite the `regions` attribute of existing articles with the translator's rules
// (functions/translator/regions.mjs), so old items match what new translations store.
//
//   node scripts/normalize-regions.mjs --table <table>            # dry run: lists the changes
//   node scripts/normalize-regions.mjs --table <table> --apply    # writes them
//
// Uses only the AWS CLI (region ap-northeast-2). '<service> 가용 리전' markers are left alone;
// re-queue those to the region resolver instead. The publisher picks the changes up on its
// next run (every 15 minutes).
import { execFileSync } from 'node:child_process';
import { canonicalizeRegions } from '../functions/translator/regions.mjs';

const REGION = 'ap-northeast-2';
const args = process.argv.slice(2);
const table = args[args.indexOf('--table') + 1];
const apply = args.includes('--apply');
if (!table || table.startsWith('--')) {
  console.error('usage: normalize-regions.mjs --table <table> [--apply]');
  process.exit(2);
}

const aws = (...a) => {
  const out = execFileSync('aws', ['--region', REGION, '--output', 'json', ...a], { encoding: 'utf8', maxBuffer: 256 << 20 });
  return out.trim() ? JSON.parse(out) : {};
};

const items = [];
let startKey;
do {
  const page = aws('dynamodb', 'scan', '--table-name', table,
    '--filter-expression', 'sk = :a', '--expression-attribute-values', '{":a":{"S":"ARTICLE"}}',
    '--projection-expression', 'pk, sk, regions, title_en',
    ...(startKey ? ['--exclusive-start-key', JSON.stringify(startKey)] : []));
  items.push(...(page.Items || []));
  startKey = page.LastEvaluatedKey;
} while (startKey);

let changed = 0;
for (const it of items) {
  const before = it.regions?.S;
  if (before === undefined) continue;
  const { value: after, dropped } = canonicalizeRegions(before);
  if (after === before) continue;
  changed++;
  console.log(`${it.pk.S}  ${(it.title_en?.S || '').slice(0, 70)}`);
  console.log(`  before: ${before}`);
  console.log(`  after:  ${after || '(none)'}${dropped.length ? `   [dropped: ${dropped.join(' | ')}]` : ''}`);
  if (apply) {
    aws('dynamodb', 'update-item', '--table-name', table,
      '--key', JSON.stringify({ pk: it.pk, sk: it.sk }),
      '--update-expression', 'SET regions = :r',
      '--condition-expression', 'regions = :b',
      '--expression-attribute-values', JSON.stringify({ ':r': { S: after }, ':b': { S: before } }));
  }
}
console.log(`\n${items.length} articles, ${changed} ${apply ? 'updated' : 'would change (dry run; add --apply)'}`);
