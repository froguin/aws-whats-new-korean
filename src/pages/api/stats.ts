import type { APIRoute } from 'astro';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

const TABLE = process.env.TABLE_NAME || 'aws-whats-new-prod';
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const GET: APIRoute = async () => {
  try {
    const [ko, en] = await Promise.all([
      ddb.send(new QueryCommand({
        TableName: TABLE, IndexName: 'gsi1',
        KeyConditionExpression: 'gsi1pk = :pk',
        ExpressionAttributeValues: { ':pk': 'LANG#ko' },
        Select: 'COUNT',
      })),
      ddb.send(new QueryCommand({
        TableName: TABLE, IndexName: 'gsi1',
        KeyConditionExpression: 'gsi1pk = :pk',
        ExpressionAttributeValues: { ':pk': 'LANG#en' },
        Select: 'COUNT',
      })),
    ]);

    return new Response(JSON.stringify({
      translated: ko.Count || 0,
      total: en.Count || 0,
      backlog: (en.Count || 0) - (ko.Count || 0),
    }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
    });
  } catch (e) {
    console.error('Stats error:', e);
    return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500 });
  }
};
