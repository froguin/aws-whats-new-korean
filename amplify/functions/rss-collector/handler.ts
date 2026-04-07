import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';

const RSS_URL = 'https://aws.amazon.com/about-aws/whats-new/recent/feed/';
const TABLE = process.env.TABLE_NAME;
const QUEUE_URL = process.env.QUEUE_URL;
const TTL_DAYS = 30;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sqs = new SQSClient({});

function parseRSS(xml: string) {
  const items: { title: string; link: string; description: string; pubDate: string }[] = [];
  const regex = /<item>[\s\S]*?<\/item>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const block = match[0];
    const get = (t: string) => {
      const m = block.match(new RegExp(`<${t}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${t}>`));
      if (!m) return '';
      return m[1].replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '').trim();
    };
    const title = get('title').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    const link = get('link') || get('guid');
    const description = get('description').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000);
    const pubDate = get('pubDate');
    if (title && link) {
      items.push({ title, link, description, pubDate: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString() });
    }
  }
  return items;
}

export const handler = async () => {
  const resp = await fetch(RSS_URL, { headers: { 'User-Agent': 'AWSWhatsNewKR/1.0' } });
  if (!resp.ok) throw new Error(`RSS fetch failed: ${resp.status}`);
  const xml = await resp.text();
  const items = parseRSS(xml).slice(0, 50);

  let newCount = 0;
  const sqsMessages: { Id: string; MessageBody: string }[] = [];
  const ttl = Math.floor(Date.now() / 1000) + TTL_DAYS * 86400;

  for (const item of items) {
    const articleId = Buffer.from(item.link).toString('base64url').slice(0, 64);
    const existing = await ddb.send(new QueryCommand({
      TableName: TABLE, KeyConditionExpression: 'pk = :pk AND sk = :sk',
      ExpressionAttributeValues: { ':pk': `ARTICLE#${articleId}`, ':sk': 'EN' }, Limit: 1,
    }));
    if (existing.Items?.length > 0) continue;

    await ddb.send(new PutCommand({
      TableName: TABLE,
      Item: {
        pk: `ARTICLE#${articleId}`, sk: 'EN',
        gsi1pk: 'LANG#en', gsi1sk: item.pubDate,
        articleId, title: item.title, description: item.description,
        url: item.link, pubDate: item.pubDate, lang: 'en', ttl,
        createdAt: new Date().toISOString(),
      },
    }));

    sqsMessages.push({
      Id: String(newCount),
      MessageBody: JSON.stringify({ articleId, title: item.title, description: item.description, url: item.link, pubDate: item.pubDate }),
    });
    newCount++;
  }

  for (let i = 0; i < sqsMessages.length; i += 10) {
    await sqs.send(new SendMessageBatchCommand({ QueueUrl: QUEUE_URL, Entries: sqsMessages.slice(i, i + 10) }));
  }

  console.log(`RSS: ${items.length} total, ${newCount} new, ${sqsMessages.length} queued`);
  return { newArticles: newCount, queued: sqsMessages.length };
};
