import type { APIRoute } from 'astro';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const TABLE = process.env.TABLE_NAME || 'aws-whats-new-prod';
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const GET: APIRoute = async ({ url }) => {
  const lang = url.searchParams.get('lang') || 'ko';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);

  try {
    const result = await ddb.send(new QueryCommand({
      TableName: TABLE,
      IndexName: 'gsi1',
      KeyConditionExpression: 'gsi1pk = :pk',
      ExpressionAttributeValues: { ':pk': `LANG#${lang}` },
      ScanIndexForward: false,
      Limit: limit,
    }));

    const items = (result.Items || []).map(item => ({
      articleId: item.articleId,
      title: item.title,
      summary: item.summary || item.description || '',
      target: item.target || '',
      features: item.features || '',
      regions: item.regions || '',
      status: item.status || '[]',
      url: item.url || '',
      pubDate: item.pubDate,
    }));

    return new Response(JSON.stringify({ items, count: items.length, lang }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
    });
  } catch (e) {
    console.error('DynamoDB query error:', e);
    return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500 });
  }
};
