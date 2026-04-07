import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';


const TABLE = process.env.TABLE_NAME;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' };

// Simple rate limiting
const ipCounts = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const entry = ipCounts.get(ip);
  if (!entry || now > entry.reset) { ipCounts.set(ip, { count: 1, reset: now + 60000 }); return false; }
  return ++entry.count > 60;
}

export const handler = async (event) => {
  const ip = event.requestContext?.http?.sourceIp || 'unknown';
  if (isRateLimited(ip)) return { statusCode: 429, headers, body: '{"error":"Too many requests"}' };

  const path = event.rawPath || '/';
  const params = event.queryStringParameters || {};

  if (path === '/articles') {
    const limit = Math.min(parseInt(params.limit || '50'), 200);
    const status = params.status || 'translated'; // translated | pending | all
    const result = await ddb.send(new QueryCommand({
      TableName: TABLE, IndexName: 'gsi1',
      KeyConditionExpression: 'gsi1pk = :pk',
      ExpressionAttributeValues` },
      ScanIndexForward: false, Limit: limit,
    }));
    const items = (result.Items || []).map(i => ({
      id: i.pk, title: i.title_ko || i.title_en, titleEn: i.title_en,
      summary: i.summary_ko || '', description: i.description || '',
      target: i.target || '', features: i.features || '', regions: i.regions || '',
      status: i.status || '[]', url: i.url || i.pk, pubDate: i.pubDate,
    }));
    return { statusCode: 200, headers, body: JSON.stringify({ items, count: items.length }) };
  }

  if (path === '/stats') {
    const [translated, pending] = await Promise.all([
      ddb.send(new QueryCommand({ TableName: TABLE, IndexName: 'gsi1', KeyConditionExpression: 'gsi1pk = :pk', ExpressionAttributeValues, Select: 'COUNT' })),
      ddb.send(new QueryCommand({ TableName: TABLE, IndexName: 'gsi1', KeyConditionExpression: 'gsi1pk = :pk', ExpressionAttributeValues, Select: 'COUNT' })),
    ]);
    return { statusCode: 200, headers, body: JSON.stringify({ translated: translated.Count || 0, pending: pending.Count || 0, total: (translated.Count || 0) + (pending.Count || 0) }) };
  }

  return { statusCode: 404, headers, body: '{"error":"Not found"}' };
};
