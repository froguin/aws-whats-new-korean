import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const TABLE = process.env.TABLE_NAME;
const REGION_RESOLVER_QUEUE_URL = process.env.REGION_RESOLVER_QUEUE_URL;
const sqsClient = new SQSClient({});

// ── Region extraction fallback (supplements LLM output) ──
const REGION_MAP = {
  'US East (N. Virginia)': '미국 동부(버지니아 북부)', 'US East (Ohio)': '미국 동부(오하이오)',
  'US West (Oregon)': '미국 서부(오레곤)', 'US West (N. California)': '미국 서부(북부 캘리포니아)',
  'Asia Pacific (Seoul)': '아시아 태평양(서울)', 'Asia Pacific (Tokyo)': '아시아 태평양(도쿄)',
  'Asia Pacific (Osaka)': '아시아 태평양(오사카)', 'Asia Pacific (Singapore)': '아시아 태평양(싱가포르)',
  'Asia Pacific (Sydney)': '아시아 태평양(시드니)', 'Asia Pacific (Melbourne)': '아시아 태평양(멜버른)',
  'Asia Pacific (Mumbai)': '아시아 태평양(뭄바이)', 'Asia Pacific (Hong Kong)': '아시아 태평양(홍콩)',
  'Asia Pacific (Jakarta)': '아시아 태평양(자카르타)', 'Asia Pacific (Hyderabad)': '아시아 태평양(하이데라바드)',
  'Asia Pacific (Malaysia)': '아시아 태평양(말레이시아)', 'Asia Pacific (Thailand)': '아시아 태평양(태국)',
  'Europe (Ireland)': '유럽(아일랜드)', 'Europe (London)': '유럽(런던)',
  'Europe (Frankfurt)': '유럽(프랑크푸르트)', 'Europe (Paris)': '유럽(파리)',
  'Europe (Stockholm)': '유럽(스톡홀름)', 'Europe (Milan)': '유럽(밀라노)',
  'Europe (Spain)': '유럽(스페인)', 'Europe (Zurich)': '유럽(취리히)',
  'Canada (Central)': '캐나다(중부)', 'Canada West (Calgary)': '캐나다 서부(캘거리)',
  'South America (Sao Paulo)': '남아메리카(상파울루)',
  'Middle East (Bahrain)': '중동(바레인)', 'Middle East (UAE)': '중동(UAE)',
  'Africa (Cape Town)': '아프리카(케이프타운)', 'Israel (Tel Aviv)': '이스라엘(텔아비브)',
  'AWS GovCloud (US-East)': 'AWS GovCloud(미국-동부)', 'AWS GovCloud (US-West)': 'AWS GovCloud(미국-서부)',
};
const AVAIL_REGION_RE = /(?:available|supported|launched?)\s+in\s+[^.]*?(?:US East|US West|Europe|Asia Pacific|Canada West|Canada|South America|Middle East|Africa|Israel|AWS GovCloud|China)\s*\(([^)]+)\)/gi;
const INDIVIDUAL_RE = /(?:US East|US West|Europe|Asia Pacific|Canada West|Canada|South America|Middle East|Africa|Israel|AWS GovCloud|China)\s*\(([^)]+)\)/g;

function extractRegionsFromText(description) {
  if (!description) return new Set();
  const found = new Set();
  // Split on sentence-ending periods (not abbreviation periods like "N. Virginia")
  const cleanDesc = description.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ');
  const availSentences = cleanDesc.match(/[^.]*(?:available|supported|launched)\s+in\s+[^.]*(?:\.[^.)]*\))?[^.]*/gi) || [];
  for (const sent of availSentences) {
    if (/(?:console|request|support|contact)\s+(?:in|through|via)/i.test(sent)) continue;
    if (/except/i.test(sent)) continue;
    let m;
    const re = new RegExp(INDIVIDUAL_RE.source, 'g');
    while ((m = re.exec(sent)) !== null) {
      const prefix = m[0].split('(')[0].trim();
      const cities = m[1].split(',').map(c => c.trim());
      for (const city of cities) {
        const key = `${prefix} (${city})`;
        const mapped = REGION_MAP[key];
        if (mapped) found.add(mapped);
      }
    }
  }
  return found;
}

function normalizeRegionList(regions) {
  // "아시아 태평양(도쿄, 서울)" → "아시아 태평양(도쿄), 아시아 태평양(서울)"
  const expanded = regions.replace(/([^,()]+)\(([^)]+)\)/g, (match, prefix, cities) => {
    if (!cities.includes(',')) return match;
    return cities.split(',').map(c => `${prefix.trim()}(${c.trim()})`).join(', ');
  });
  return expanded.replace(/,([^ ])/g, ', $1'); // ensure space after comma
}

function mergeRegions(llmRegions, regexRegions) {
  if (!llmRegions || llmRegions.startsWith('__SERVICE__:')) return llmRegions;
  // If LLM says "모든 AWS 리전" (possibly with extras), normalize
  if (llmRegions.includes('모든 AWS 리전')) return '모든 AWS 리전';
  const normalized = normalizeRegionList(llmRegions);
  const llmSet = new Set(normalized.split(',').map(s => s.trim()).filter(Boolean));
  for (const r of regexRegions) llmSet.add(r);
  return [...llmSet].join(', ');
}
const TRANSLATE_MODEL = process.env.BEDROCK_TRANSLATE_MODEL;
const REVIEW_MODEL = process.env.BEDROCK_REVIEW_MODEL;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const bedrock = new BedrockRuntimeClient({});

const RULES = `<rules>
- 제품명, 버전, 날짜, 리전 코드는 영어 유지
- 그 외 모든 영어는 한국어로 번역. 혼용 금지 (예: "및" not "and 및")
- AWS 표준 용어: instance→인스턴스, deploy→배포, serverless→서버리스
- title: 제품명 + 변경 내용을 담은 완결된 제목. 목표 40자, 최대 55자 이내로 짧게. "출시" "지원"만 단독 사용 금지. 길면 부가 수식을 빼서 핵심만 담되, 문장을 도중에 끊거나 말줄임표(…, ...)를 절대 쓰지 말고 반드시 완결된 형태로 작성
- summary: 한국어 2문장, 목표 120자, 최대 150자 이내. 첫째: 무엇이 변경. 둘째: 왜 중요. 길면 부가 설명을 덜어내고 핵심만 남기되, 문장을 도중에 끊거나 말줄임표를 절대 쓰지 말고 완결된 문장으로 마무리
- status: "preview"→미리보기, "beta"→베타, "retired"→지원 종료, "GA"/"launched"→정식 출시
- 버전 문자열의 "beta"/"preview"는 서비스 상태가 아님
- target: 한 문장, 최대 50자
- features: 쉼표 구분, 최대 3개, 총 80자
- regions: 서비스가 실제로 가용한(available/supported/launched) 리전만 추출. 아래 규칙 준수:
  - "all regions" 또는 글로벌 서비스 → "모든 AWS 리전"
  - "available in all regions where X is available" 패턴 → "__SERVICE__:서비스코드" (예: "__SERVICE__:eks", "__SERVICE__:lambda")
  - 구체적 리전이 나열된 경우 → 나열된 리전을 하나도 빠짐없이 모두 추출하여 한국어로 변환. US East, US West 포함 절대 누락 금지
  - 출력 형식: 각 리전을 "지역(도시)" 형태로 개별 나열. 쉼표로 구분. 하나의 괄호 안에 여러 도시 묶지 말 것 (예: "아시아 태평양(도쿄), 아시아 태평양(서울)" O, "아시아 태평양(도쿄, 서울)" X)
  - "모든 AWS 리전"과 구체적 리전을 혼합하지 말 것. 글로벌이면 "모든 AWS 리전"만 출력
  - 절차 안내 문맥("use the console in...", "request through...")에서 언급된 리전은 제외
  - "except" 뒤의 리전은 제외 리전이므로 추출하지 않음
  - 리전 정보가 없거나 불명확하면 "모든 AWS 리전"
  - 리전명 변환표: US East (N. Virginia)→미국 동부(버지니아 북부), US East (Ohio)→미국 동부(오하이오), US West (Oregon)→미국 서부(오레곤), US West (N. California)→미국 서부(북부 캘리포니아), Asia Pacific (Seoul)→아시아 태평양(서울), Asia Pacific (Tokyo)→아시아 태평양(도쿄), Asia Pacific (Singapore)→아시아 태평양(싱가포르), Asia Pacific (Sydney)→아시아 태평양(시드니), Asia Pacific (Mumbai)→아시아 태평양(뭄바이), Europe (Ireland)→유럽(아일랜드), Europe (Frankfurt)→유럽(프랑크푸르트), Europe (London)→유럽(런던), Canada (Central)→캐나다(중부), AWS GovCloud (US-West)→AWS GovCloud(미국-서부), AWS GovCloud (US-East)→AWS GovCloud(미국-동부) 등
</rules>`;

const KOREAN_STYLE = `<korean-style>
한국어 번역 품질 지침: 의미가 명확하고 자연스러운 한국어 문장을 출력해야 합니다.

0. 【길이】 title은 목표 40자·최대 55자로 짧게, summary는 목표 2문장·150자로 간결하게 씁니다. 부가 설명·배경·수식·나열은 과감히 생략해 되도록 짧게 만듭니다. 다만 길이를 맞추려고 문장을 도중에 끊거나 의미를 훼손하지 말고, 말줄임표(…, ...)도 절대 쓰지 않으며, 항상 완결된 문장으로 마무리합니다. 정보가 많아 부득이 길어지더라도 완결성을 우선합니다.
1. 조사와 어미를 생략하지 않습니다. 부사, 보조사, 보조 용언을 적극 활용하여 의미를 명확히 합니다.
   [기능 제공 시작 → 이 기능을 사용할 수 있게 되었습니다]
   [데이터 암호화 지원 → 데이터를 암호화하는 기능을 지원합니다]
2. summary는 서술어와 종결어미를 사용하여 완성된 문장으로 작성합니다. 명사구나 연결어미로 끝내지 않습니다.
   [비용 절감 및 성능 향상 → 비용을 절감하고 성능을 향상할 수 있습니다]
   title은 간결한 서술형("~합니다")을 기본으로 하되, 40자 제한 내에서 명사형 종결도 허용합니다.
   [Amazon ECS에서 Fargate 스팟 지원 → Amazon ECS Fargate에서 스팟 용량을 지원합니다]
3. 의미가 있는 문장 성분을 생략하지 않습니다. 읽는 사람이 맥락 없이도 내용을 이해할 수 있어야 합니다.
   [이를 통해 개선 가능 → 이 기능을 활용하면 응답 시간을 단축할 수 있습니다]
4. 비유적 어휘 대신 일반적이고 직관적인 어휘를 사용합니다.
   [워크로드를 태울 수 있는 → 워크로드를 실행할 수 있는]
5. '~의'를 남용하지 않고, 구체적인 조사와 어미로 관계를 표현합니다.
   [서비스의 가용성의 향상 → 서비스 가용성이 향상되었습니다]
6. 엠대시(—)를 자제하고, 접속사나 콜론으로 대체합니다.
7. 고유 명사와 기술 용어는 정착된 번역어가 있으면 사용하고, 없으면 원어를 유지합니다.
8. 번역투 표현을 지양합니다:
   - "~에 대한" → "~을/를" 또는 적절한 조사 [보안에 대한 강화 → 보안 강화]
   - "~를 통해" → "~(으)로", "~을/를 활용하면" [이 기능을 통해 비용 절감 → 이 기능으로 비용을 절감]
   - "~를 위한" → "~에 필요한", "~용" [배포를 위한 도구 → 배포용 도구]
9. 의미 없는 수식어를 넣지 않습니다:
   - "해당" — 지시 대상이 분명하면 생략 [해당 기능을 → 이 기능을]
   - "다양한" — 구체적으로 쓰거나 생략 [다양한 기능을 제공 → 주요 기능 3가지를 제공]
   - "보다 나은" — 비교 대상을 명시하거나 "향상된"으로 대체
</korean-style>`;

const SYS = `한국어 클라우드 뉴스 요약기. 출력: 유효한 JSON만. 마크다운/코드펜스 금지.\n${KOREAN_STYLE}\n${RULES}`;
const REV = `한국어 클라우드 뉴스 카드 검수기. 아래 한국어 품질 지침과 규칙을 기준으로 위반 사항을 수정합니다.\n${KOREAN_STYLE}\n${RULES}\n<review-focus>\n- 조사/어미 누락: "기능 제공" → "기능을 제공합니다"처럼 완성된 문장인지 확인\n- 번역투 표현: "~에 대한", "~를 통해" 남용 여부 확인\n- 명사 나열: 서술어 없이 명사만 나열된 문장이 있으면 서술어를 보충\n- 의미 불분명: 주어나 목적어가 누락되어 뜻이 모호한 경우 보충\n- summary는 반드시 200자 이내로 유지. 초과 시 핵심만 남기고 축약\n</review-focus>\n<output>\n반드시 JSON 객체 하나만 출력합니다. 설명 문장, 머리말, 코드펜스를 절대 붙이지 않습니다. 응답은 반드시 '{' 로 시작해서 '}' 로 끝나야 합니다.\n수정할 필드가 있으면 그 필드만 담은 JSON을 출력합니다. 예: {"summary":"..."}\n수정할 것이 없으면 정확히 이것만 출력합니다: {"pass":true}\n</output>`;

const FEW = [
  { role: 'user', content: [{ text: '<article>\nTitle: AWS Lambda now supports Python 3.13 runtime\nDescription: Customers can now create and update Lambda functions using Python 3.13. This runtime includes improved error messages and performance enhancements. Python 3.13 is available in all AWS Regions where Lambda is available.\n</article>' }] },
  { role: 'assistant', content: [{ text: '{"title":"AWS Lambda에서 Python 3.13 런타임을 지원합니다","summary":"Lambda 함수를 생성하거나 업데이트할 때 Python 3.13 런타임을 선택할 수 있게 되었습니다. 오류 메시지가 개선되고 성능이 향상되었으므로, Python 기반 Lambda 함수를 운영하고 있다면 업그레이드를 검토해 보시기 바랍니다.","target":"Python 기반 Lambda 함수를 개발하는 사용자","features":"Python 3.13 런타임, 오류 메시지 개선, 성능 향상","regions":"__SERVICE__:lambda","status":"정식 출시"}' }] },
  { role: 'user', content: [{ text: '<article>\nTitle: Amazon S3 now supports up to 1 million buckets per account\nDescription: Amazon S3 customers can now create up to 1 million general purpose buckets in each of their AWS accounts, a 100x increase from the previous default quota of 10,000 buckets per account. This is available in all AWS Regions.\n</article>' }] },
  { role: 'assistant', content: [{ text: '{"title":"Amazon S3 계정당 버킷 한도가 100만 개로 확대됩니다","summary":"AWS 계정 하나에 생성할 수 있는 범용 버킷의 기본 할당량이 기존 1만 개에서 100만 개로 100배 증가했습니다. 대규모 멀티테넌트 아키텍처를 운영하거나 테넌트별 버킷을 분리해야 하는 경우에 특히 유용합니다.","target":"대규모 멀티테넌트 환경을 운영하는 개발자 및 아키텍트","features":"계정당 버킷 100만 개, 기본 할당량 100배 증가","regions":"모든 AWS 리전","status":"정식 출시"}' }] },
];

async function invoke(modelId, system, messages) {
  const r = await bedrock.send(new InvokeModelCommand({
    modelId, contentType: 'application/json', accept: 'application/json',
    body: JSON.stringify({ schemaVersion: 'messages-v1', system: [{ text: system }], messages, inferenceConfig: { temperature: 0, maxTokens: 1024 } }),
  }));
  let t = JSON.parse(new TextDecoder().decode(r.body)).output?.message?.content?.[0]?.text || '';
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  // 모델이 설명문을 덧붙이는 경우(예: "수정된 필드 JSON은..."), 첫 번째 완전한 JSON 객체만 추출
  try {
    return JSON.parse(t);
  } catch {
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start !== -1 && end > start) {
      return JSON.parse(t.slice(start, end + 1));
    }
    throw new Error('no_json_in_response');
  }
}

function validate(r) {
  const errors = [];
  if (!r.title || r.title.length < 5) errors.push('title_short');
  if (r.title && r.title.length > 100) errors.push('title_long');
  if (!r.summary || r.summary.length < 10) errors.push('summary_short');
  if (r.summary && r.summary.length > 400) errors.push('summary_long');
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

      // 원문은 절대 자르지 않는다(잘림/말줄임표는 요약의 의미를 훼손). 표시 길이는 UI에서 처리.
      // 길이 초과는 재시도로 모델이 다시 짧고 완결된 형태로 생성하게 하고, 검증 상한은 완결형 긴 문장도 통과하도록 넉넉히 둔다.
      errors = validate(r);

      // 최종 검증 실패 → SQS 재시도 (DLQ로 이동)
      if (errors.length > 0) {
        throw new Error(`Incomplete: ${errors.join(',')}`);
      }

      const ft = Array.isArray(r.features) ? r.features.join(', ') : (r.features || '');
      const regexRegions = extractRegionsFromText(description);
      const regionsVal = mergeRegions(r.regions || '모든 AWS 리전', regexRegions);
      const serviceMatch = regionsVal.match(/^__SERVICE__:(.+)$/);

      await ddb.send(new UpdateCommand({
        TableName: TABLE, Key: { pk: guid, sk: 'ARTICLE' },
        UpdateExpression: 'SET title_ko=:tk, summary_ko=:sk, target=:tg, features=:ft, regions=:rg, #st=:st, #u=if_not_exists(#u,:u), gsi1pk=:g, translatedAt=:ta',
        ExpressionAttributeNames: { '#st': 'status', '#u': 'url' },
        ExpressionAttributeValues: { ':tk': r.title||'', ':sk': r.summary||'', ':tg': r.target||'', ':ft': ft, ':rg': serviceMatch ? `${serviceMatch[1]} 가용 리전` : regionsVal, ':st': normalizeStatus(r.status), ':u': url || guid, ':g': 'STATUS#translated', ':ta': new Date().toISOString() },
      }));

      if (serviceMatch && REGION_RESOLVER_QUEUE_URL) {
        await sqsClient.send(new SendMessageCommand({
          QueueUrl: REGION_RESOLVER_QUEUE_URL,
          MessageBody: JSON.stringify({ guid, service: serviceMatch[1] }),
        }));
        console.log(`REGION_QUEUE ${guid}: ${serviceMatch[1]}`);
      }
      console.log(`OK ${guid}: ${r.title}`);
    } catch (e) { console.error(`FAIL ${guid}:`, e.message); throw e; }
  }
};
