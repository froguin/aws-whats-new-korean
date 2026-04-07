import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import type { SQSEvent } from 'aws-lambda';

const TABLE = process.env.TABLE_NAME;
const TRANSLATE_MODEL = process.env.BEDROCK_TRANSLATE_MODEL;
const REVIEW_MODEL = process.env.BEDROCK_REVIEW_MODEL;
const TTL_DAYS = 30;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const bedrock = new BedrockRuntimeClient({});

// ── Prompts ──

const TRANSLATION_RULES = `- Keep product names, versions, dates, region codes in English as-is
- Translate ALL other English to Korean. Never mix (e.g. write "및" not "and 및")
- Title: product name + core change. Remove status tags like [Preview], [Launched], [Retired], (GA)
- Summary: 2 sentences. First: what changed. Second: why it matters
- Status from description: "preview" → 미리보기, "beta" → 베타, "retired"/"deprecated" → 지원 종료, "GA"/"launched" → 정식 출시
- IMPORTANT: "beta"/"preview" in a version string (e.g. v1.2.0-beta01) is NOT a service status
- Features: 3 capability descriptions
- Regions: AWS Korean region names (e.g. 아시아 태평양(서울) 리전) or "모든 AWS 리전"`;

const SYSTEM_PROMPT = `You are a Korean cloud news summarizer for IT professionals.
OUTPUT: valid JSON only, no markdown wrapping.
RULES:\n${TRANSLATION_RULES}`;

const REVIEW_PROMPT = `You review Korean cloud news cards. Find errors in the translation.
Compare against the original English and check these rules:
${TRANSLATION_RULES}
Find and fix:
1. Chinese/Japanese characters mixed in Korean text
2. Hallucinated content not in the original
3. Garbled, truncated, or unnatural text
4. Status field contradicting the description
5. Title too vague or mirroring English too closely
OUTPUT JSON with corrected fields only. If correct: {"pass":true}`;

const FEW_SHOT = [
  { role: 'user', content: 'Title: AWS Lambda now supports Python 3.13 runtime\nDescription: Customers can now create and update Lambda functions using Python 3.13.' },
  { role: 'assistant', content: '{"title":"AWS Lambda에서 Python 3.13 런타임 지원","summary":"Lambda 함수에서 Python 3.13의 주요 기능을 활용할 수 있게 되었습니다. 기존 Python 함수를 운영 중이라면 런타임 업그레이드를 검토할 시점입니다.","target":"Lambda 기반 서버리스 백엔드를 Python으로 운영하는 개발자","features":"Python 3.13 런타임 선택 가능, 오류 메시지 개선, 성능 향상","regions":"Lambda가 제공되는 모든 AWS 리전","status":["정식 출시"]}' },
];

// ── Bedrock helpers ──

async function invokeModel(modelId: string, messages: { role: string; content: { text: string }[] | string }[]) {
  const resp = await bedrock.send(new InvokeModelCommand({
    modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({ schemaVersion: 'messages-v1', system: [{ text: SYSTEM_PROMPT }], messages }),
  }));
  const parsed = JSON.parse(new TextDecoder().decode(resp.body));
  let text = parsed.output?.message?.content?.[0]?.text || '';
  // Strip markdown code fences (```json ... ```)
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  return JSON.parse(text);
}

// ── Quality gate ──

function assessQuality(record: Record<string, string>) {
  const issues: string[] = [];
  if (!record.title || record.title.length < 5) issues.push('title_too_short');
  if (!record.summary || record.summary.length < 20) issues.push('summary_too_short');
  if (/[一-龥ぁ-ヿ]/.test(record.title + record.summary)) issues.push('cjk_contamination');
  if (/[_*`]/.test(record.summary)) issues.push('markdown_artifacts');
  if (/and 및/.test(record.title)) issues.push('mixed_language');
  return issues;
}

// ── Pipeline ──

async function translate(article: { title: string; description: string }) {
  const userMsg = `Title: ${article.title}\nDescription: ${article.description}`;
  const messages = [...FEW_SHOT, { role: 'user', content: [{ text: userMsg }] }];
  const formatted = messages.map(m => ({
    role: m.role,
    content: Array.isArray(m.content) ? m.content : [{ text: m.content }],
  }));
  return invokeModel(TRANSLATE_MODEL!, formatted);
}

async function review(article: { title: string; description: string }, record: Record<string, string>) {
  const userMsg = `Original Title: ${article.title}\nOriginal Description: ${article.description}\n\nTranslated:\n${JSON.stringify(record)}`;
  const messages = [{ role: 'user', content: [{ text: userMsg }] }];
  try {
    const result = await invokeModel(REVIEW_MODEL!, messages);
    if (result.pass) return record;
    return { ...record, ...result, pass: undefined };
  } catch {
    return record;
  }
}

export const handler = async (event: SQSEvent) => {
  for (const sqsRecord of event.Records) {
    const article = JSON.parse(sqsRecord.body);
    const { articleId } = article;
    const ttl = Math.floor(Date.now() / 1000) + TTL_DAYS * 86400;

    try {
      let record = await translate(article);

      const issues = assessQuality(record);
      if (issues.length > 0) {
        console.warn(`Quality issues for ${articleId}: ${issues.join(', ')}. Retrying...`);
        record = await translate(article);
      }

      record = await review(article, record);

      const finalIssues = assessQuality(record);
      if (finalIssues.includes('cjk_contamination')) {
        record.summary = record.summary.replace(/[一-龥ぁ-ヿ]/g, '');
        record.title = record.title.replace(/[一-龥ぁ-ヿ]/g, '');
      }

      await ddb.send(new PutCommand({
        TableName: TABLE,
        Item: {
          pk: `ARTICLE#${articleId}`, sk: 'KO',
          gsi1pk: 'LANG#ko', gsi1sk: article.pubDate,
          articleId, lang: 'ko',
          title: record.title, summary: record.summary,
          target: record.target, features: record.features,
          regions: record.regions, status: JSON.stringify(record.status || []),
          url: article.url, pubDate: article.pubDate,
          translateModel: TRANSLATE_MODEL, reviewModel: REVIEW_MODEL,
          translatedAt: new Date().toISOString(),
          reviewedAt: new Date().toISOString(),
          ttl,
        },
      }));

      console.log(`Translated ${articleId}: ${record.title}`);
    } catch (err: unknown) {
      console.error(`Failed ${articleId}:`, (err as Error).message);
      throw err;
    }
  }
};
