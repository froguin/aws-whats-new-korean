#!/usr/bin/env node
/**
 * Re-queue existing translated articles for re-translation based on original English fields.
 *
 * Usage:
 *   TABLE_NAME=<dynamodb-table> QUEUE_URL=<sqs-url> node scripts/retranslate-existing.cjs
 *
 * Optional:
 *   LIMIT=500 DRY_RUN=1 node scripts/retranslate-existing.cjs
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { SQSClient, SendMessageBatchCommand } = require('@aws-sdk/client-sqs');

const TABLE = process.env.TABLE_NAME;
const QUEUE_URL = process.env.QUEUE_URL;
const LIMIT = Number(process.env.LIMIT || '0'); // 0 = no limit
const DRY_RUN = process.env.DRY_RUN === '1';

if (!TABLE || !QUEUE_URL) {
  console.error('Required env vars: TABLE_NAME, QUEUE_URL');
  process.exit(1);
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sqs = new SQSClient({});

async function* translatedArticles() {
  let lastKey;
  let emitted = 0;

  do {
    const page = await ddb.send(new QueryCommand({
      TableName: TABLE,
      IndexName: 'gsi1',
      KeyConditionExpression: 'gsi1pk = :pk',
      ExpressionAttributeValues: { ':pk': 'STATUS#translated' },
      ScanIndexForward: false,
      Limit: 200,
      ExclusiveStartKey: lastKey,
    }));

    for (const item of page.Items || []) {
      if (LIMIT > 0 && emitted >= LIMIT) return;
      emitted += 1;
      yield item;
    }

    lastKey = page.LastEvaluatedKey;
  } while (lastKey && (LIMIT === 0 || emitted < LIMIT));
}

function toMessage(item) {
  return {
    guid: item.pk,
    url: item.url || item.pk,
    title: item.title_en || item.title_ko || '',
    description: item.description || '',
    pubDate: item.pubDate || new Date().toISOString(),
  };
}

async function sendBatch(batch, counterStart) {
  if (batch.length === 0) return 0;
  if (DRY_RUN) return batch.length;

  const Entries = batch.map((body, i) => ({
    Id: String(counterStart + i),
    MessageBody: JSON.stringify(body),
  }));

  const result = await sqs.send(new SendMessageBatchCommand({ QueueUrl: QUEUE_URL, Entries }));
  if ((result.Failed || []).length > 0) {
    const sample = result.Failed[0];
    throw new Error(`Failed to send SQS batch: ${sample.Code || 'Unknown'} ${sample.Message || ''}`);
  }

  return batch.length;
}

async function main() {
  console.log(`[start] table=${TABLE} limit=${LIMIT || 'all'} dryRun=${DRY_RUN}`);

  let queued = 0;
  let scanned = 0;
  let batch = [];

  for await (const item of translatedArticles()) {
    scanned += 1;
    if (!item.pk || !item.title_en || !item.description) continue;

    batch.push(toMessage(item));

    if (batch.length === 10) {
      queued += await sendBatch(batch, queued);
      batch = [];
    }

    if (scanned % 100 === 0) {
      console.log(`[progress] scanned=${scanned} queued=${queued}`);
    }
  }

  queued += await sendBatch(batch, queued);
  console.log(`[done] scanned=${scanned} queued=${queued} dryRun=${DRY_RUN}`);
}

main().catch((err) => {
  console.error('[error]', err.message || err);
  process.exit(1);
});
