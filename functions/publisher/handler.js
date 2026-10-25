import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

// Publisher: snapshots all translated articles from DynamoDB into a single
// static JSON file on the site bucket (served by CloudFront). Visitors read
// that cached file instead of hitting the runtime API, so the public API no
// longer sits in the request path — lower cost, smaller attack surface.
//
// Runs on a schedule (a few minutes after each 15-min collection cycle) and
// also on demand (any invoke). Its JSON schema matches the frontend's article model.
// so the frontend's data shape is unchanged.

const TABLE = process.env.TABLE_NAME;
const SITE_BUCKET = process.env.SITE_BUCKET;
const OBJECT_KEY = process.env.OBJECT_KEY || 'articles.json';
// The site bucket lives in us-east-1 (with the CloudFront distribution), while
// this Lambda runs in ap-northeast-2. The S3 client must target the bucket's
// own region or S3 answers 301 PermanentRedirect on the cross-region request.
const SITE_BUCKET_REGION = process.env.SITE_BUCKET_REGION || 'us-east-1';
// Short edge/browser cache: fresh within one collection cycle without needing
// a CloudFront invalidation on every run.
const CACHE_CONTROL = process.env.CACHE_CONTROL || 'public, max-age=300, s-maxage=300';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({ region: SITE_BUCKET_REGION });

function mapItem(i) {
  return {
    id: i.pk,
    title: i.title_ko || i.title_en,
    titleEn: i.title_en,
    summary: i.summary_ko || i.description || '',
    description: i.description || '',
    target: i.target || '',
    features: i.features || '',
    regions: i.regions || '',
    status: i.status || '정식 출시',
    url: i.url || i.pk,
    pubDate: i.pubDate,
  };
}

async function queryAllTranslated() {
  const items = [];
  let ExclusiveStartKey;
  do {
    const result = await ddb.send(new QueryCommand({
      TableName: TABLE,
      IndexName: 'gsi1',
      KeyConditionExpression: 'gsi1pk = :pk',
      ExpressionAttributeValues: { ':pk': 'STATUS#translated' },
      ScanIndexForward: false,
      ...(ExclusiveStartKey ? { ExclusiveStartKey } : {}),
    }));
    for (const i of result.Items || []) items.push(mapItem(i));
    ExclusiveStartKey = result.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

export const handler = async () => {
  if (!TABLE || !SITE_BUCKET) {
    throw new Error('TABLE_NAME and SITE_BUCKET must be set');
  }
  const items = await queryAllTranslated();
  const body = JSON.stringify({
    generatedAt: new Date().toISOString(),
    count: items.length,
    items,
  });

  await s3.send(new PutObjectCommand({
    Bucket: SITE_BUCKET,
    Key: OBJECT_KEY,
    Body: body,
    ContentType: 'application/json; charset=utf-8',
    CacheControl: CACHE_CONTROL,
  }));

  return { published: items.length, bucket: SITE_BUCKET, key: OBJECT_KEY };
};
