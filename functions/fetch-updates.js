import { parse } from 'rss-to-json';
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { getStore } from "@netlify/blobs";

const RSS_URL = 'https://aws.amazon.com/about-aws/whats-new/recent/feed/'
const CACHE_KEY = 'aws-updates-v2';
const CACHE_TTL_DAY = 7; // 7일간 정보 유지
const MAX_ITEMS_TO_PROCESS = 3; // 최대 처리할 항목 수

// AWS Bedrock 클라이언트 초기화
const bedrockClient = new BedrockRuntimeClient({
  region: process.env.CUSTOM_AWS_REGION,
  credentials: {
    accessKeyId: process.env.CUSTOM_AWS_ACCESS_KEY,
    secretAccessKey: process.env.CUSTOM_AWS_SECRET_KEY
  }
});

// Nova Lite 모델을 사용한 요약 및 번역 함수
async function invokeNovaLiteSummarization(title, description) {
  const systemPrompt = generateSystemPrompt(title, description);
  const params = {
    modelId: 'us.amazon.nova-lite-v1:0',
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      schemaVersion: "messages-v1",
      messages: [{ role: "user", content: [{ text: systemPrompt }] }],
    })
  };

  try {
    const command = new InvokeModelCommand(params);
    const response = await bedrockClient.send(command);
    const decodedResponseBody = new TextDecoder().decode(response.body);
    console.log('응답 본문:', decodedResponseBody);
    if (!decodedResponseBody) {
      throw new Error('응답 본문이 비어 있습니다.');
    }
    const parsedResponse = JSON.parse(decodedResponseBody);
    if (!parsedResponse.output || !parsedResponse.output.message || !Array.isArray(parsedResponse.output.message.content) || parsedResponse.output.message.content.length === 0) {
      throw new Error('유효한 content가 응답에 포함되어 있지 않습니다.');
    }
    const jsonString = parsedResponse.output.message.content[0].text;
    let summaryData = JSON.parse(jsonString);
    return parseModelResponse(summaryData);
  } catch (error) {
    console.error('Nova 모델 호출 중 오류:', error);
    throw error;
  }
}

function parseModelResponse(responseText) {
  try {
    const responseString = typeof responseText === 'string' ? responseText : JSON.stringify(responseText);
    const jsonStart = responseString.indexOf('{', responseString.indexOf('"title"'));
    const jsonEnd = responseString.lastIndexOf('}');
    const jsonString = responseString.substring(jsonStart, jsonEnd + 1);
    const cleanedJson = jsonString
      .replace(/\\n/g, ' ')
      .replace(/\\t/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/\\\\"/g, '"')
      .replace(/\\'/g, "'")
      .trim();
    const parsedResponse = JSON.parse(cleanedJson);
    if (typeof parsedResponse.content === 'string' && parsedResponse.content.startsWith('{')) {
      try {
        parsedResponse.content = JSON.parse(parsedResponse.content);
      } catch (contentError) {
        console.warn('content 파싱 실패:', contentError);
      }
    }
    return {
      title: parsedResponse.title || '제목 없음',
      summary: parsedResponse.summary || '내용 없음',
      target: parsedResponse.target || "모든 AWS 사용자",
      features: parsedResponse.features || "자세한 내용은 원문을 참조하세요",
      regions: parsedResponse.regions || "지원 리전 정보 없음",
      status: parsedResponse.status || "알 수 없음"
    };
  } catch (error) {
    console.error('JSON 파싱 오류:', error);
    return {
      title: '파싱 오류 발생',
      summary: responseText
    };
  }
}

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

**Example JSON Response:**
{
  "title": "AWS Lambda 기능 개선 발표",
  "summary": "AWS Lambda가 새로운 메모리 옵션과 고급 모니터링 기능을 제공합니다.",
  "target": "서버리스 애플리케이션 개발자",
  "features": "메모리 옵션, 고급 모니터링",
  "regions": "모든 AWS 리전",
  "status": "정식 출시"
}
  `;
}

// 캐시 저장 함수
async function saveCache(store, items) {
  const cachedData = await store.get(CACHE_KEY);
  const existingItems = cachedData ? JSON.parse(cachedData).items : []; // 기존 아이템 읽기

  // 기존 아이템과 새로운 아이템을 결합
  const combinedItems = [...existingItems, ...items];

  // GUID 기반으로 중복 제거
  const uniqueItems = Array.from(new Set(combinedItems.map(item => item.id)))
      .map(id => combinedItems.find(item => item.id === id)); // GUID에 해당하는 아이템 찾기

  // 캐시 데이터 저장
  await store.set(CACHE_KEY, JSON.stringify({
      timestamp: new Date().toISOString(),
      items: uniqueItems // 최종 아이템 저장
  }));
}

let store;

async function processItem(item) {
  const itemId = item.id;
  const itemPubDate = new Date(item.published).toISOString();

  try {
    console.log('처리 시작:', item.title.substring(0, 30) + '...');
    const summaryResponse = await invokeNovaLiteSummarization(item.title, item.description);
    console.log('처리 완료:', item.title.substring(0, 30) + '...');

    const newItem = {
      title: summaryResponse.title,
      date: new Date(item.published).toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }),
      content: summaryResponse.summary,
      target: summaryResponse.target || "모든 AWS 사용자",
      features: summaryResponse.features || "자세한 내용은 원문을 참조하세요",
      regions: summaryResponse.regions || "지원 리전 정보 없음",
      status: summaryResponse.status || "일반 공개",
      originalLink: item.link || '',
      id: itemId,
      pubDate: itemPubDate
    };

    return newItem;
  } catch (error) {
    console.error(`아이템 처리 중 오류 (ID: ${itemId}):`, error);
    return null;
  }
}

// 최근 아이템 필터링 함수
function filterRecentItems(rssItems) {
  const anAgo = new Date();
  anAgo.setDate(anAgo.getDate() - CACHE_TTL_DAY);
  return rssItems.filter(item => new Date(item.published) >= anAgo);
}

export const handler = async () => {
  try {
    console.log('=== Function started ===');
    // 환경 변수 확인
    const requiredEnvVars = ['CUSTOM_AWS_ACCESS_KEY', 'CUSTOM_AWS_SECRET_KEY', 'CUSTOM_AWS_REGION', 'NETLIFY_SITE_ID', 'NETLIFY_ACCESS_TOKEN'];
    requiredEnvVars.forEach(varName => {
      if (!process.env[varName]) {
        throw new Error(`Required environment variable ${varName} is missing`);
      }
    });
    console.log('환경변수 확인 완료');

    // Blob 스토어 초기화
    store = getStore({
      name: "aws-updates-store",
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_ACCESS_TOKEN
    });

    // 캐시에서 기존 데이터 가져오기
    const cachedData = await store.get(CACHE_KEY);
    const processedItems = cachedData ? JSON.parse(cachedData).items : [];
    console.log(`가져온 아이템 수: ${processedItems.length}`);

    // 기존 아이템 Set 생성
    const existingItemsSet = new Set(processedItems.map(item => `${item.id}|${item.pubDate}`));
    console.log('기존 아이템 Set:', existingItemsSet);

    // RSS 피드 가져오기 및 필터링
    const rss = await parse(RSS_URL);
    console.log('RSS 객체:', rss); // RSS 객체의 구조를 확인
    console.log('전체 RSS 항목 수:', rss.items.length);
    const recentItems = filterRecentItems(rss.items);
    console.log('일주일 이내 항목 수:', recentItems.length);

    // 중복되지 않는 아이템만 필터링
    const newItems = recentItems.filter(item => {
      const itemId = item.id;
      const itemPubDate = new Date(item.published).toISOString();
      return !existingItemsSet.has(`${itemId}|${itemPubDate}`);
    });

    console.log(`업데이트가 필요한 항목 수: ${newItems.length}`);

    if (newItems.length > 0) {
      let processedCount = 0;

      for (const item of newItems) {
        if (processedCount >= MAX_ITEMS_TO_PROCESS) {
          console.log(`최대 처리 아이템 수(${MAX_ITEMS_TO_PROCESS})에 도달했습니다. 더 이상 처리하지 않습니다.`);
          break; // 최대 처리 수에 도달하면 루프 종료
        }

        await processItem(item); // 중복 확인 없이 아이템 처리
        processedCount++; // 처리된 아이템 수 증가
      }
    }

    // 캐시 정리 및 저장
    const currentTime = Date.now();
    const filteredItems = processedItems.filter(item => {
      const itemTime = new Date(item.pubDate).getTime();
      return (currentTime - itemTime) < (CACHE_TTL_DAY * 24 * 60 * 60 * 1000); // 7일보다 큰 경우 제거
    });

    // GUID와 pubDate가 같은 아이템 중복 제거
    const uniqueItems = Array.from(new Set(filteredItems.map(item => `${item.id}|${item.pubDate}`)))
      .map(id => filteredItems.find(item => `${item.id}|${item.pubDate}` === id));

    // pubDate 기준으로 최신 정보가 맨 앞에 오도록 정렬
    uniqueItems.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

    // 정리한 내용을 캐시에 저장
    await saveCache(store, uniqueItems);
    console.log(`총 캐시된 아이템 수: ${uniqueItems.length}`);
    console.log('=== Function completed ===');
  } catch (error) {
    console.error('Error in handler:', error);
  }
};
