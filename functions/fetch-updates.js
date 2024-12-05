import { parse } from 'rss-to-json';
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { getStore } from "@netlify/blobs";

const CACHE_KEY = 'aws-updates-v2';
const MAX_ITEMS_TO_PROCESS = 3;
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7일간 유지

const bedrockClient = new BedrockRuntimeClient({
  region: process.env.CUSTOM_AWS_REGION,
  credentials: {
    accessKeyId: process.env.CUSTOM_AWS_ACCESS_KEY,
    secretAccessKey: process.env.CUSTOM_AWS_SECRET_KEY
  }
});

let store;

// 시스템 프롬프트 생성 함수
function generateSystemPrompt(title, description) {
  return `
You are an expert in analyzing AWS service updates and providing concise, structured summaries for Korean-speaking AWS users.

Original Title: ${title}
Original Description: ${description}

Please provide a **single-line JSON-formatted response** with the following structure:
{
  "title": "한국어로 번역된 명확하고 간결한 제목",
  "summary": "3-4문장으로 주요 업데이트 내용을 한국어로 요약 (250자 이하)",
  "target": "이 업데이트의 주요 대상 사용자 그룹 (단일 문장)",
  "features": "주요 기능 또는 변경 사항 요약 (100자 이하)",
  "regions": "지원되는 AWS 리전 (알려진 경우, 없으면 '해당 없음')",
  "status": "현재 상태 (예: 정식 출시 ('일반 공개'인 경우도 정식 출시로 표시합니다), 미리보기 ('프리뷰' 또는 '미리보기 단계'인 경우도 미리보기로 표기합니다) 등으로 표기합니다)"
}

**Important Guidelines:**
1. 응답은 **단일 줄**로 작성하고 줄바꿈이나 탭 문자를 사용하지 마십시오.
2. 각 필드 값은 평문 문자열로 작성하고 중첩된 JSON을 포함하지 마십시오.
3. 모든 필드는 JSON.parse()로 바로 파싱 가능해야 합니다.
4. 알 수 없는 정보는 "알 수 없음" 또는 "해당 없음"으로 작성하십시오.
5. 응답은 **최대 300자**를 넘지 않도록 간결하게 작성하십시오.
6. 번역 시에 AWS 또는 Amazon 으로 시작하는 제품명은 원문 그대로 표현하는 것이 좋습니다.
  `;
}

// RSS 피드 요약 요청
async function invokeSummarization(title, description) {
  const prompt = generateSystemPrompt(title, description);
  const params = {
    modelId: 'us.amazon.nova-lite-v1:0',
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      schemaVersion: "messages-v1",
      messages: [{ role: "user", content: prompt }]
    })
  };

  const command = new InvokeModelCommand(params);
  const response = await bedrockClient.send(command);
  const decodedResponse = new TextDecoder().decode(response.body);
  return JSON.parse(decodedResponse);
}

// 캐시 저장
async function saveCache(items) {
  const cacheData = { timestamp: new Date().toISOString(), items };
  await store.set(CACHE_KEY, JSON.stringify(cacheData));
  console.log('캐시 저장 완료:', items.length, '개');
}

async function handler() {
  try {
    console.log('=== Function started ===');
    store = getStore({
      name: "aws-updates-store",
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_ACCESS_TOKEN
    });

    // 1. 기존 캐시 확인 및 출력
    const cachedData = await store.get(CACHE_KEY);
    const processedItems = cachedData ? JSON.parse(cachedData).items : [];
    console.log('기존 캐시:', JSON.stringify(processedItems, null, 2));

    const existingItemsSet = new Set(
      processedItems.map(item => `${item.guid}|${item.pubDate}`)
    );

    // 2. RSS 피드 파싱
    const rss = await parse('https://aws.amazon.com/about-aws/whats-new/recent/feed/');
    const recentItems = rss.items.filter(item => {
      const guid = item.guid?.__text || 'unknown-guid';
      const pubDate = new Date(item.pubDate).toISOString();
      return !existingItemsSet.has(`${guid}|${pubDate}`);
    });

    console.log('새로운 업데이트 항목 수:', recentItems.length);

    // 3. 새로운 항목 요약 및 추가
    let processedCount = 0;
    for (const item of recentItems) {
      if (processedCount >= MAX_ITEMS_TO_PROCESS) break;

      const guid = item.guid.__text;
      const pubDate = new Date(item.pubDate).toISOString();

      try {
        const summary = await invokeSummarization(item.title, item.description);
        const newItem = {
          title: summary.title,
          date: new Date(pubDate).toLocaleDateString('ko-KR'),
          content: summary.summary,
          guid,
          pubDate,
          originalLink: item.link || ''
        };
        processedItems.unshift(newItem); // 최신 항목 앞에 추가
        await saveCache(processedItems); // 요약 후 즉시 저장
        console.log('새 항목 추가 완료:', newItem.title);
        processedCount++;
      } catch (error) {
        console.error('요약 중 오류 발생:', error);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify(processedItems, null, 2) // 캐시된 모든 아이템 출력
    };
  } catch (error) {
    console.error('오류 발생:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: '처리 오류' })
    };
  }
}

export { handler };