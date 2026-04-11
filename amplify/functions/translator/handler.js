import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const TABLE = process.env.TABLE_NAME;
const TRANSLATE_MODEL = process.env.BEDROCK_TRANSLATE_MODEL;
const REVIEW_MODEL = process.env.BEDROCK_REVIEW_MODEL;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const bedrock = new BedrockRuntimeClient({});

const RULES = `<rules>
- 제품명, 버전, 날짜, 리전 코드는 영어 유지
- 그 외 모든 영어는 한국어로 번역. 혼용 금지 (예: "및" not "and 및")
- AWS 표준 용어: instance→인스턴스, deploy→배포, serverless→서버리스
- title: 제품명 + 변경 내용, 최대 40자. "출시" "지원"만 단독 사용 금지
- summary: 한국어 2문장, 최대 150자. 첫째: 무엇이 변경. 둘째: 왜 중요
- status: "preview"→미리보기, "beta"→베타, "retired"→지원 종료, "GA"/"launched"→정식 출시
- 버전 문자열의 "beta"/"preview"는 서비스 상태가 아님
- target: 한 문장, 최대 50자
- features: 쉼표 구분, 최대 3개, 총 80자
- regions: 생략 (자동 추출됨)
</rules>`;

// ── Region extraction from English description ──
const REGION_MAP = {
  'US East (N. Virginia)': '미국 동부(버지니아 북부)', 'US East (Ohio)': '미국 동부(오하이오)',
  'US West (Oregon)': '미국 서부(오레곤)', 'US West (N. California)': '미국 서부(북부 캘리포니아)',
  'Asia Pacific (Seoul)': '아시아 태평양(서울)', 'Asia Pacific (Tokyo)': '아시아 태평양(도쿄)',
  'Asia Pacific (Osaka)': '아시아 태평양(오사카)', 'Asia Pacific (Singapore)': '아시아 태평양(싱가포르)',
  'Asia Pacific (Sydney)': '아시아 태평양(시드니)', 'Asia Pacific (Melbourne)': '아시아 태평양(멜버른)',
  'Asia Pacific (Mumbai)': '아시아 태평양(뭄바이)', 'Asia Pacific (Hong Kong)': '아시아 태평양(홍콩)',
  'Asia Pacific (Jakarta)': '아시아 태평양(자카르타)', 'Asia Pacific (Hyderabad)': '아시아 태평양(하이데라바드)',
  'Asia Pacific (Malaysia)': '아시아 태평양(말레이시아)', 'Asia Pacific (New Zealand)': '아시아 태평양(뉴질랜드)',
  'Asia Pacific (Taipei)': '아시아 태평양(타이베이)', 'Asia Pacific (Thailand)': '아시아 태평양(태국)',
  'Europe (Ireland)': '유럽(아일랜드)', 'Europe (London)': '유럽(런던)',
  'Europe (Frankfurt)': '유럽(프랑크푸르트)', 'Europe (Paris)': '유럽(파리)',
  'Europe (Stockholm)': '유럽(스톡홀름)', 'Europe (Milan)': '유럽(밀라노)',
  'Europe (Spain)': '유럽(스페인)', 'Europe (Zurich)': '유럽(취리히)',
  'Canada (Central)': '캐나다(중부)', 'Canada (West)': '캐나다(서부)',
  'South America (Sao Paulo)': '남아메리카(상파울루)', 'South America (São Paulo)': '남아메리카(상파울루)',
  'Middle East (Bahrain)': '중동(바레인)', 'Middle East (UAE)': '중동(UAE)',
  'Africa (Cape Town)': '아프리카(케이프타운)', 'Israel (Tel Aviv)': '이스라엘(텔아비브)',
  'China (Beijing)': '중국(베이징)', 'China (Ningxia)': '중국(닝샤)',
  'AWS GovCloud (US)': 'AWS GovCloud(미국)', 'AWS GovCloud (US-East)': 'AWS GovCloud(미국-동부)',
  'AWS GovCloud (US-West)': 'AWS GovCloud(미국-서부)',
};
const ALL_REGION_RE = /\b[Aa]ll\s+(?:(?:commercial|public|supported)\s+)?(?:AWS\s+)?(?:commercial\s+)?[Rr]egions?\b/;
const INDIVIDUAL_RE = /(?:US|Europe|Asia Pacific|Canada|South America|Middle East|Africa|Israel|AWS GovCloud|China)\s*\(([^)]+)\)/g;

function extractRegions(description) {
  if (!description) return '모든 AWS 리전';
  if (ALL_REGION_RE.test(description)) return '모든 AWS 리전';
  const found = new Set();
  let m;
  while ((m = INDIVIDUAL_RE.exec(description)) !== null) {
    const full = m[0];
    // Handle compound: "Europe (Frankfurt, Ireland, London)"
    const prefix = full.split('(')[0].trim();
    const cities = m[1].split(',').map(c => c.trim());
    for (const city of cities) {
      const key = `${prefix} (${city})`;
      const mapped = REGION_MAP[key];
      if (mapped) found.add(mapped);
      else found.add(`${prefix}(${city})`); // fallback: keep structure
    }
  }
  return found.size > 0 ? [...found].join(', ') : '모든 AWS 리전';
}

const SYS = `한국어 클라우드 뉴스 요약기. 출력: 유효한 JSON만. 마크다운/코드펜스 금지.\n${RULES}`;
const REV = `한국어 클라우드 뉴스 카드 검수. 규칙 위반 수정:\n${RULES}\n<output>수정된 필드 JSON만. 정상이면: {"pass":true}</output>`;

const FEW = [
  { role: 'user', content: [{ text: '<article>\nTitle: AWS Lambda now supports Python 3.13 runtime\nDescription: Customers can now create and update Lambda functions using Python 3.13.\n</article>' }] },
  { role: 'assistant', content: [{ text: '{"title":"AWS Lambda에서 Python 3.13 런타임 지원","summary":"Lambda 함수에서 Python 3.13을 사용할 수 있게 되었습니다. 기존 Python 함수 운영 중이라면 업그레이드를 검토할 시점입니다.","target":"Python 기반 Lambda 개발자","features":"Python 3.13 런타임, 오류 메시지 개선, 성능 향상","regions":"모든 AWS 리전","status":"정식 출시"}' }] },
];

async function invoke(modelId, system, messages) {
  const r = await bedrock.send(new InvokeModelCommand({
    modelId, contentType: 'application/json', accept: 'application/json',
    body: JSON.stringify({ schemaVersion: 'messages-v1', system: [{ text: system }], messages, inferenceConfig: { temperature: 0 } }),
  }));
  let t = JSON.parse(new TextDecoder().decode(r.body)).output?.message?.content?.[0]?.text || '';
  return JSON.parse(t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim());
}

function validate(r) {
  const errors = [];
  if (!r.title || r.title.length < 5) errors.push('title_short');
  if (r.title && r.title.length > 60) errors.push('title_long');
  if (!r.summary || r.summary.length < 10) errors.push('summary_short');
  if (r.summary && r.summary.length > 200) errors.push('summary_long');
  if (!r.target) errors.push('target_missing');
  if (!r.features) errors.push('features_missing');
  const cjk = ((r.title || '') + (r.summary || '')).match(/[一-龥ぁ-ヿ]/g);
  if (cjk && cjk.length >= 3) errors.push('cjk_contamination');
  if (/[_*`#]/.test(r.summary || '')) errors.push('markdown_artifacts');
  return errors;
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
      const userText = `<article>\nTitle: ${title}\nDescription: ${description}\n</article>`;
      const msg = [...FEW, { role: 'user', content: [{ text: userText }] }];

      // 1차 번역 (Nova Lite)
      let r = await invoke(TRANSLATE_MODEL, SYS, msg);
      let errors = validate(r);

      // 검증 실패 시 1회 재시도
      if (errors.length > 0) {
        console.log(`RETRY ${guid}: ${errors.join(',')}`);
        r = await invoke(TRANSLATE_MODEL, SYS, msg);
        errors = validate(r);
      }

      // 여전히 실패 시 검수 모델(Nova Micro)로 보정 시도
      if (errors.length > 0) {
        console.log(`REVIEW ${guid}: ${errors.join(',')}`);
        try {
          const rev = await invoke(REVIEW_MODEL, REV, [{ role: 'user', content: [{ text: `<original>\nTitle: ${title}\nDescription: ${description}\n</original>\n<translated>\n${JSON.stringify(r)}\n</translated>\n<errors>${errors.join(',')}</errors>` }] }]);
          if (!rev.pass) r = { ...r, ...rev, pass: undefined };
        } catch (e) { console.warn(`REVIEW_FAIL ${guid}:`, e.message); }
        errors = validate(r);
      }

      // 최종 검증 실패 → SQS 재시도 (DLQ로 이동)
      if (errors.length > 0) {
        throw new Error(`Incomplete: ${errors.join(',')}`);
      }

      const ft = Array.isArray(r.features) ? r.features.join(', ') : (r.features || '');
      await ddb.send(new UpdateCommand({
        TableName: TABLE, Key: { pk: guid, sk: 'ARTICLE' },
        UpdateExpression: 'SET title_ko=:tk, summary_ko=:sk, target=:tg, features=:ft, regions=:rg, #st=:st, #u=if_not_exists(#u,:u), gsi1pk=:g, translatedAt=:ta',
        ExpressionAttributeNames: { '#st': 'status', '#u': 'url' },
        ExpressionAttributeValues: { ':tk': r.title||'', ':sk': r.summary||'', ':tg': r.target||'', ':ft': ft, ':rg': extractRegions(description), ':st': normalizeStatus(r.status), ':u': url || guid, ':g': 'STATUS#translated', ':ta': new Date().toISOString() },
      }));
      console.log(`OK ${guid}: ${r.title}`);
    } catch (e) { console.error(`FAIL ${guid}:`, e.message); throw e; }
  }
};
