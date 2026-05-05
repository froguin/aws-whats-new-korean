import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const TABLE = process.env.TABLE_NAME;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const DEFAULT_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300', Vary: 'Origin' };

const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/[a-z0-9-]+\.amplifyapp\.com$/,
  /^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.amplifyapp\.com$/,
  /^http:\/\/localhost(?::\d{1,5})?$/,
  /^http:\/\/127\.0\.0\.1(?::\d{1,5})?$/,
];

function resolveCorsHeaders(origin = '') {
  if (!origin) return DEFAULT_HEADERS;
  const isAllowed = ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin));
  if (!isAllowed) return DEFAULT_HEADERS;
  return {
    ...DEFAULT_HEADERS,
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

const ipCounts = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const entry = ipCounts.get(ip);
  if (!entry || now > entry.reset) { ipCounts.set(ip, { count: 1, reset: now + 60000 }); return false; }
  return ++entry.count > 60;
}

export const handler = async (event) => {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  const headers = resolveCorsHeaders(origin);

  if ((event.requestContext?.http?.method || '').toUpperCase() === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  const ip = event.requestContext?.http?.sourceIp || 'unknown';
  if (isRateLimited(ip)) return { statusCode: 429, headers, body: '{"error":"Too many requests"}' };

  const path = event.rawPath || '/';
  const params = event.queryStringParameters || {};

  if (path === '/articles') {
    const limit = Math.min(parseInt(params.limit || '50'), 200);
    const status = params.status || 'translated';
    const queryParams = {
      TableName: TABLE, IndexName: 'gsi1',
      KeyConditionExpression: 'gsi1pk = :pk',
      ExpressionAttributeValues: { ':pk': `STATUS#${status}` },
      ScanIndexForward: false, Limit: limit,
    };
    if (params.nextToken) {
      try { queryParams.ExclusiveStartKey = JSON.parse(Buffer.from(params.nextToken, 'base64url').toString()); } catch {}
    }
    const result = await ddb.send(new QueryCommand(queryParams));
    const items = (result.Items || []).map(i => ({
      id: i.pk, title: i.title_ko || i.title_en, titleEn: i.title_en,
      summary: i.summary_ko || i.description || '', description: i.description || '',
      target: i.target || '', features: i.features || '', regions: i.regions || '',
      status: i.status || '정식 출시', url: i.url || i.pk, pubDate: i.pubDate,
    }));
    const nextToken = result.LastEvaluatedKey ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64url') : null;
    return { statusCode: 200, headers, body: JSON.stringify({ items, count: items.length, nextToken }) };
  }

  if (path === '/stats') {
    const [translated, pending] = await Promise.all([
      ddb.send(new QueryCommand({ TableName: TABLE, IndexName: 'gsi1', KeyConditionExpression: 'gsi1pk = :pk', ExpressionAttributeValues: { ':pk': 'STATUS#translated' }, Select: 'COUNT' })),
      ddb.send(new QueryCommand({ TableName: TABLE, IndexName: 'gsi1', KeyConditionExpression: 'gsi1pk = :pk', ExpressionAttributeValues: { ':pk': 'STATUS#pending' }, Select: 'COUNT' })),
    ]);
    return { statusCode: 200, headers, body: JSON.stringify({ translated: translated.Count || 0, pending: pending.Count || 0, total: (translated.Count || 0) + (pending.Count || 0) }) };
  }

  return { statusCode: 404, headers, body: '{"error":"Not found"}' };
};
