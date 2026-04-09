import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const TABLE = process.env.TABLE_NAME;
const TRANSLATE_MODEL = process.env.BEDROCK_TRANSLATE_MODEL;
const REVIEW_MODEL = process.env.BEDROCK_REVIEW_MODEL;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const bedrock = new BedrockRuntimeClient({});

const RULES = `- Keep product names, versions, dates, region codes in English as-is
- Translate ALL other English to Korean. Never mix (e.g. "및" not "and 및")
- Title: product name + what changed, max 40 chars. Never just "출시" or "지원" alone
- Summary: exactly 2 Korean sentences, max 150 chars. First: what changed. Second: why it matters
- Status: "preview"→미리보기, "beta"→베타, "retired"→지원 종료, "GA"/"launched"→정식 출시
- "beta"/"preview" in version strings is NOT a service status
- Target: single sentence, max 50 chars
- Features: comma-separated, max 3 items, max 80 chars total
- Regions: AWS Korean region names or "모든 AWS 리전", max 60 chars`;

const SYS = `You are a Korean cloud news summarizer. OUTPUT: valid JSON only, no markdown, no code fences.\nRULES:\n${RULES}`;
const REV = `Review Korean cloud news cards. Fix errors per rules:\n${RULES}\nOUTPUT corrected fields JSON only. If correct: {"pass":true}`;

const FEW = [
  { role: 'user', content: [{ text: 'Title: AWS Lambda now supports Python 3.13 runtime\nDescription: Customers can now create and update Lambda functions using Python 3.13.' }] },
  { role: 'assistant', content: [{ text: '{"title":"AWS Lambda에서 Python 3.13 런타임 지원","summary":"Lambda 함수에서 Python 3.13의 주요 기능을 활용할 수 있게 되었습니다. 기존 Python 함수 운영 중이라면 업그레이드를 검토할 시점입니다.","target":"Python 기반 Lambda 개발자","features":"Python 3.13 런타임, 오류 메시지 개선, 성능 향상","regions":"모든 AWS 리전","status":["정식 출시"]}' }] },
];

async function invoke(modelId, system, messages) {
  const r = await bedrock.send(new InvokeModelCommand({
    modelId, contentType: 'application/json', accept: 'application/json',
    body: JSON.stringify({ schemaVersion: 'messages-v1', system: [{ text: system }], messages }),
  }));
  let t = JSON.parse(new TextDecoder().decode(r.body)).output?.message?.content?.[0]?.text || '';
  return JSON.parse(t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim());
}

function normalizeStatus(status) {
  const raw = Array.isArray(status) ? status.join(', ') : String(status || '').trim();
  const s = raw.toLowerCase();
  if (!s) return '정식 출시';
  if (s.includes('정식 출시') || s.includes('launched') || s.includes('ga') || s === 'general availability') return '정식 출시';
  if (s.includes('미리보기') || s.includes('preview')) return '미리보기';
  if (s.includes('베타') || s.includes('beta')) return '베타';
  if (s.includes('지원 종료') || s.includes('retired') || s.includes('deprecated')) return '지원 종료';
  return raw;
}

export const handler = async (event) => {
  for (const rec of event.Records) {
    const { guid, url, title, description } = JSON.parse(rec.body);
    try {
      const msg = [...FEW, { role: 'user', content: [{ text: `Title: ${title}\nDescription: ${description}` }] }];
      let r = await invoke(TRANSLATE_MODEL, SYS, msg);
      const valid = (o) => o.title?.length >= 5 && o.summary?.length >= 10 && o.target && o.features && o.regions;
      if (!valid(r) || /[一-龥ぁ-ヿ]/.test(r.title + r.summary)) r = await invoke(TRANSLATE_MODEL, SYS, msg);
      if (!valid(r)) r = await invoke(TRANSLATE_MODEL, SYS, msg);
      try {
        const rev = await invoke(REVIEW_MODEL, REV, [{ role: 'user', content: [{ text: `Original: ${title}\n\nTranslated:\n${JSON.stringify(r)}` }] }]);
        if (!rev.pass) r = { ...r, ...rev, pass: undefined };
      } catch {}
      if (!valid(r)) throw new Error(`Incomplete translation: ${JSON.stringify({title:!!r.title,summary:!!r.summary,target:!!r.target,features:!!r.features,regions:!!r.regions})}`);
      const ft = Array.isArray(r.features) ? r.features.join(', ') : (r.features || '');
      await ddb.send(new UpdateCommand({
        TableName: TABLE, Key: { pk: guid, sk: 'ARTICLE' },
        UpdateExpression: 'SET title_ko=:tk, summary_ko=:sk, target=:tg, features=:ft, regions=:rg, #st=:st, #u=if_not_exists(#u,:u), gsi1pk=:g, translatedAt=:ta',
        ExpressionAttributeNames: { '#st': 'status', '#u': 'url' },
        ExpressionAttributeValues: { ':tk': r.title||'', ':sk': r.summary||'', ':tg': r.target||'', ':ft': ft, ':rg': r.regions||'', ':st': normalizeStatus(r.status), ':u': url || guid, ':g': 'STATUS#translated', ':ta': new Date().toISOString() },
      }));
      console.log(`OK ${guid}: ${r.title}`);
    } catch (e) { console.error(`FAIL ${guid}:`, e.message); throw e; }
  }
};
