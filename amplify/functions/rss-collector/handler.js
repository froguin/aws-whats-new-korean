import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';

const RSS_URL = 'https://aws.amazon.com/about-aws/whats-new/recent/feed/';
const TABLE = process.env.TABLE_NAME;
const QUEUE_URL = process.env.QUEUE_URL;
const TTL_DAYS = 30;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sqs = new SQSClient({});

function parseRSS(xml) {
  const items = [];
  const regex = /<item>[\s\S]*?<\/item>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const block = match[0];
    const get = (t) => {
      const m = block.match(new RegExp(`<${t}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${t}>`));
      if (!m) return '';
      return m[1].replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '').trim();
    };
    const title = get('title').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    const link = get('link');
    const guid = get('guid') || link;
    const description = get('description').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000);
    const pubDate = get('pubDate');
    if (title && guid) {
      items.push({ title, guid, link: link || guid, description, pubDate: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString() });
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
  const sqsMessages = [];
  const ttl = Math.floor(Date.now() / 1000) + TTL_DAYS * 86400;

  for (const item of items) {
    const existing = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: item.guid, sk: 'ARTICLE' } }));
    if (existing.Item) continue;

    await ddb.send(new PutCommand({
      TableName: TABLE,
      Item: {
        pk: item.guid, sk: 'ARTICLE',
        gsi1pk: 'STATUS#pending', gsi1sk: item.pubDate,
        title_en: item.title, description: item.description,
        url: item.link || item.guid, pubDate: item.pubDate, ttl,
        createdAt: new Date().toISOString(),
      },
    }));

    sqsMessages.push({
      Id: String(newCount),
      MessageBody: JSON.stringify({ guid: item.guid, url: item.link || item.guid, title: item.title, description: item.description, pubDate: item.pubDate }),
    });
    newCount++;
  }

  for (let i = 0; i < sqsMessages.length; i += 10) {
    await sqs.send(new SendMessageBatchCommand({ QueueUrl: QUEUE_URL, Entries: sqsMessages.slice(i, i + 10) }));
  }

  console.log(`RSS: ${items.length} total, ${newCount} new, ${sqsMessages.length} queued`);
  return { newArticles: newCount, queued: sqsMessages.length };
};
