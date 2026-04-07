import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import type { SQSHandler } from 'aws-lambda';

const TABLE = process.env.TABLE_NAME!;
const TRANSLATE_MODEL = process.env.BEDROCK_TRANSLATE_MODEL!;
const REVIEW_MODEL = process.env.BEDROCK_REVIEW_MODEL!;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const bedrock = new BedrockRuntimeClient({});

const SYSTEM_PROMPT = `You are a Korean cloud news summarizer for IT professionals.
OUTPUT: valid JSON only, no markdown wrapping, no code fences.
RULES:
- Keep product names, versions, dates, region codes in English as-is
- Translate ALL other English to Korean
- Title: product name + core change. Remove status tags like [Preview], [Launched]
- Summary: 2 sentences. First: what changed. Second: why it matters
- Status: "preview" → 미리보기, "beta" → 베타, "retired" → 지원 종료, "GA"/"launched" → 정식 출시
- "beta"/"preview" in version strings is NOT a service status
- Features: 3 capability descriptions
- Regions: AWS Korean region names or "모든 AWS 리전"`;

const REVIEW_PROMPT = `You review Korean cloud news cards. Find errors:
1. Chinese/Japanese characters in Korean text
2. Hallucinated content not in the original
3. Garbled or truncated text
4. Status contradicting the description
5. Title too vague or mirroring English
OUTPUT JSON with corrected fields only. No code fences. If correct: {"pass":true}`;

async function invokeModel(modelId: string, system: string, userMsg: string) {
  const resp = await bedrock.send(new InvokeModelCommand({
    modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      schemaVersion: 'messages-v1',
      system: [{ text: system }],
      messages: [{ role: 'user', content: [{ text: userMsg }] }],
    }),
  }));
  const parsed = JSON.parse(new TextDecoder().decode(resp.body));
  let text = parsed.output?.message?.content?.[0]?.text || '';
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  return JSON.parse(text);
}

function assessQuality(record: any) {
  const issues: string[] = [];
  if (!record.title || record.title.length < 5) issues.push('title_too_short');
  if (!record.summary || record.summary.length < 20) issues.push('summary_too_short');
  if (/[一-龥ぁ-ヿ]/.test((record.title || '') + (record.summary || ''))) issues.push('cjk_contamination');
  if (/[_*`]/.test(record.summary || '')) issues.push('markdown_artifacts');
  return issues;
}

export const handler: SQSHandler = async (event) => {
  for (const sqsRecord of event.Records) {
    const article = JSON.parse(sqsRecord.body);
    const { guid, title, description, pubDate } = article;

    try {
      // Step 1: Translate
      const userMsg = `Title: ${title}\nDescription: ${description}`;
      let record = await invokeModel(TRANSLATE_MODEL, SYSTEM_PROMPT, userMsg);

      // Step 2: Quality gate — retry once if issues
      if (assessQuality(record).length > 0) {
        record = await invokeModel(TRANSLATE_MODEL, SYSTEM_PROMPT, userMsg);
      }

      // Step 3: AI Review
      try {
        const reviewMsg = `Original Title: ${title}\nOriginal Description: ${description}\n\nTranslated:\n${JSON.stringify(record)}`;
        const review = await invokeModel(REVIEW_MODEL, REVIEW_PROMPT, reviewMsg);
        if (!review.pass) record = { ...record, ...review, pass: undefined };
      } catch { /* review failed, keep original */ }

      // Step 4: Clean CJK contamination
      if (/[一-龥ぁ-ヿ]/.test((record.title || '') + (record.summary || ''))) {
        record.title = (record.title || '').replace(/[一-龥ぁ-ヿ]/g, '');
        record.summary = (record.summary || '').replace(/[一-龥ぁ-ヿ]/g, '');
      }

      // Save: UpdateItem on existing row
      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { pk: guid, sk: 'ARTICLE' },
        UpdateExpression: 'SET title_ko = :tk, summary_ko = :sk, target = :tg, features = :ft, regions = :rg, #st = :st, gsi1pk = :gsi1pk, translatedAt = :ta, translateModel = :tm, reviewModel = :rm',
        ExpressionAttributeNames: { '#st': 'status' },
        ExpressionAttributeValues: {
          ':tk': record.title || '',
          ':sk': record.summary || '',
          ':tg': record.target || '',
          ':ft': record.features || '',
          ':rg': record.regions || '',
          ':st': JSON.stringify(record.status || []),
          ':gsi1pk': 'STATUS#translated',
          ':ta': new Date().toISOString(),
          ':tm': TRANSLATE_MODEL,
          ':rm': REVIEW_MODEL,
        },
      }));

      console.log(`Translated ${guid}: ${record.title}`);
    } catch (err: any) {
      console.error(`Failed ${guid}:`, err.message);
      throw err;
    }
  }
};
