const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const TABLE = process.env.TABLE_NAME;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const headers = {
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=300',
  'Access-Control-Allow-Origin': '*',
};

exports.handler = async (event) => {
  const path = event.rawPath || '/';
  const params = event.queryStringParameters || {};

  if (path === '/articles') {
    const lang = params.lang || 'ko';
    const limit = Math.min(parseInt(params.limit || '50'), 200);
    const result = await ddb.send(new QueryCommand({
      TableName: TABLE, IndexName: 'gsi1',
      KeyConditionExpression: 'gsi1pk = :pk',
      ExpressionAttributeValues: { ':pk': `LANG#${lang}` },
      ScanIndexForward: false, Limit: limit,
    }));
    const items = (result.Items || []).map(i => ({
      articleId: i.articleId, title: i.title, summary: i.summary || i.description || '',
      target: i.target || '', features: i.features || '', regions: i.regions || '',
      status: i.status || '[]', url: i.url || '', pubDate: i.pubDate,
    }));
    return { statusCode: 200, headers, body: JSON.stringify({ items, count: items.length, lang }) };
  }

  if (path === '/stats') {
    const [ko, en] = await Promise.all([
      ddb.send(new QueryCommand({ TableName: TABLE, IndexName: 'gsi1', KeyConditionExpression: 'gsi1pk = :pk', ExpressionAttributeValues: { ':pk': 'LANG#ko' }, Select: 'COUNT' })),
      ddb.send(new QueryCommand({ TableName: TABLE, IndexName: 'gsi1', KeyConditionExpression: 'gsi1pk = :pk', ExpressionAttributeValues: { ':pk': 'LANG#en' }, Select: 'COUNT' })),
    ]);
    return { statusCode: 200, headers, body: JSON.stringify({ translated: ko.Count || 0, total: en.Count || 0, backlog: (en.Count || 0) - (ko.Count || 0) }) };
  }

  return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found' }) };
};
