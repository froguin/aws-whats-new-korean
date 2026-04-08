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
- Title: product name + core change. Remove status tags like [Preview], [Launched]
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

export const handler = async (event) => {
  for (const rec of event.Records) {
    const { guid, title, description } = JSON.parse(rec.body);
    try {
      const msg = [...FEW, { role: 'user', content: [{ text: `Title: ${title}\nDescription: ${description}` }] }];
      let r = await invoke(TRANSLATE_MODEL, SYS, msg);
      if (!r.title || r.title.length < 5 || /[一-龥ぁ-ヿ]/.test(r.title + r.summary)) r = await invoke(TRANSLATE_MODEL, SYS, msg);
      try {
        const rev = await invoke(REVIEW_MODEL, REV, [{ role: 'user', content: [{ text: `Original: ${title}\n\nTranslated:\n${JSON.stringify(r)}` }] }]);
        if (!rev.pass) r = { ...r, ...rev, pass: undefined };
      } catch {}
      const ft = Array.isArray(r.features) ? r.features.join(', ') : (r.features || '');
      await ddb.send(new UpdateCommand({
        TableName: TABLE, Key: { pk: guid, sk: 'ARTICLE' },
        UpdateExpression: 'SET title_ko=:tk, summary_ko=:sk, target=:tg, features=:ft, regions=:rg, #st=:st, gsi1pk=:g, translatedAt=:ta',
        ExpressionAttributeNames: { '#st': 'status' },
        ExpressionAttributeValues: { ':tk': r.title||'', ':sk': r.summary||'', ':tg': r.target||'', ':ft': ft, ':rg': r.regions||'', ':st': JSON.stringify(r.status||[]), ':g': 'STATUS#translated', ':ta': new Date().toISOString() },
      }));
      console.log(`OK ${guid}: ${r.title}`);
    } catch (e) { console.error(`FAIL ${guid}:`, e.message); throw e; }
  }
};
