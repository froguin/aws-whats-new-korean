#!/usr/bin/env node
/**
 * Migrate data from Netlify Blobs to DynamoDB.
 *
 * Prerequisites:
 *   - NETLIFY_SITE_ID and NETLIFY_ACCESS_TOKEN in environment
 *   - AWS credentials configured (aws configure)
 *   - DynamoDB table already created (sam deploy)
 *
 * Usage:
 *   TABLE_NAME=aws-whats-new-prod node scripts/migrate-from-netlify.js
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const https = require('https');

const TABLE = process.env.TABLE_NAME;
const SITE_ID = process.env.NETLIFY_SITE_ID;
const TOKEN = process.env.NETLIFY_ACCESS_TOKEN;
const STORE = 'aws-updates-store';
const KEY = 'aws-updates-v2';
const TTL_DAYS = 30;

if (!TABLE || !SITE_ID || !TOKEN) {
  console.error('Required: TABLE_NAME, NETLIFY_SITE_ID, NETLIFY_ACCESS_TOKEN');
  process.exit(1);
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function fetchBlob() {
  return new Promise((resolve, reject) => {
    const url = `https://api.netlify.com/api/v1/blobs/${SITE_ID}/${STORE}/${KEY}`;
    https.get(url, { headers: { Authorization: `Bearer ${TOKEN}` } }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        resolve(JSON.parse(data));
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('Fetching Netlify Blobs data...');
  const blob = await fetchBlob();
  const items = blob.items || [];
  console.log(`Found ${items.length} items`);

  const ttl = Math.floor(Date.now() / 1000) + TTL_DAYS * 86400;
  let count = 0;

  for (const item of items) {
    const articleId = item.id || Buffer.from(item.originalLink || '').toString('base64url').slice(0, 64);
    const pubDate = item.pubDate || new Date().toISOString();

    // English original
    await ddb.send(new PutCommand({
      TableName: TABLE,
      Item: {
        pk: `ARTICLE#${articleId}`, sk: 'EN',
        gsi1pk: 'LANG#en', gsi1sk: pubDate,
        articleId, lang: 'en', url: item.originalLink || '',
        title: item.title || '', description: item.content || '',
        pubDate, ttl, createdAt: new Date().toISOString(),
      },
      ConditionExpression: 'attribute_not_exists(pk)',
    }).catch(() => {}));

    // Korean translation
    await ddb.send(new PutCommand({
      TableName: TABLE,
      Item: {
        pk: `ARTICLE#${articleId}`, sk: 'KO',
        gsi1pk: 'LANG#ko', gsi1sk: pubDate,
        articleId, lang: 'ko', url: item.originalLink || '',
        title: item.title || '', summary: item.content || '',
        target: item.target || '', features: item.features || '',
        regions: item.regions || '', status: JSON.stringify(item.status ? [item.status] : []),
        pubDate, ttl, translatedAt: new Date().toISOString(),
        migratedFrom: 'netlify',
      },
      ConditionExpression: 'attribute_not_exists(pk)',
    }).catch(() => {}));

    count++;
    if (count % 10 === 0) console.log(`  ${count}/${items.length}`);
  }

  console.log(`Migration complete: ${count} items`);
}

main().catch(console.error);
