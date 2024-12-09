import { parse } from 'rss-to-json';
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { getStore } from "@netlify/blobs";

const RSS_URL = 'https://aws.amazon.com/about-aws/whats-new/recent/feed/'
const CACHE_KEY = 'aws-updates-v2';
const CACHE_TTL_DAY = 30; // 7일간 정보 유지
const MAX_ITEMS_TO_PROCESS = 30; // 최대 처리할 항목 수

// AWS Bedrock 클라이언트 초기화
const bedrockClient = new BedrockRuntimeClient({
  region: process.env.CUSTOM_AWS_REGION,
  credentials: {
    accessKeyId: process.env.CUSTOM_AWS_ACCESS_KEY,
    secretAccessKey: process.env.CUSTOM_AWS_SECRET_KEY
  }
});

// Nova Micro 모델을 사용한 요약 및 번역 함수
async function invokeNovaMicroSummarization(title, description) {
  const systemPrompt = generateSystemPrompt(title, description);
  const params = {
    modelId: 'us.amazon.nova-micro-v1:0',
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
async function saveCache(store, items, mergeWithExisting = false) {
  let combinedItems;

  if (mergeWithExisting) {
    const cachedData = await store.get(CACHE_KEY);
    const existingItems = cachedData ? JSON.parse(cachedData).items : [];
    
    // 기존 아이템과 새로운 아이템을 결합
    combinedItems = [...existingItems, ...items];
  } else {
    // 주어진 아이템만 저장
    combinedItems = items;
  }

  // 캐시 데이터 저장
  await store.set(CACHE_KEY, JSON.stringify({
    timestamp: new Date().toISOString(),
    items: combinedItems // 최종 아이템 저장
  }));
}

let store;

async function processItem(item) {
  const itemId = item.id;
  const itemPubDate = new Date(item.published).toISOString();

  try {
    const summaryResponse = await invokeNovaMicroSummarization(item.title, item.description);

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

async function getCachedDataWithRetry(store, key, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const cachedData = await store.get(key);
      return cachedData; // 성공적으로 데이터를 가져오면 반환
    } catch (error) {
      console.error(`캐시 데이터 가져오기 실패 (시도 ${attempt + 1}):`, error);
      if (attempt === retries - 1) {
        throw new Error('최대 재시도 횟수 초과'); // 최대 재시도 횟수 초과 시 오류 발생
      }
      // 잠시 대기 후 재시도
      await new Promise(resolve => setTimeout(resolve, 200)); // 200ms 대기
    }
  }
}

export const handler = async () => {
  try {
    //console.log('=== Function started ===');
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
    let cachedData = await getCachedDataWithRetry(store, CACHE_KEY);
    let processedItems = cachedData ? JSON.parse(cachedData).items : [];
    console.log(`가져온 아이템 수: ${processedItems.length}`);

    // 기존 아이템 Set 생성
    const existingItemsSet = new Set(processedItems.map(item => `${item.id}|${item.pubDate}`));

    // RSS 피드 가져오기 및 필터링
    const rss = await parse(RSS_URL);
    const recentItems = filterRecentItems(rss.items);
    console.log('일주일 이내 항목 수:', recentItems.length);

    // 중복되지 않는 아이템만 필터링
    const newItems = recentItems.filter(item => {
      const itemid = item.id;
      const itemPubDate = new Date(item.published).toISOString();
      return !existingItemsSet.has(`${itemid}|${itemPubDate}`);
    });

    console.log(`업데이트가 필요한 항목 수: ${newItems.length}`);

    if (newItems.length > 0) {
      let processedCount = 0;

      for (const item of newItems) {
        if (processedCount >= MAX_ITEMS_TO_PROCESS) {
          console.log(`최대 처리 아이템 수(${MAX_ITEMS_TO_PROCESS})에 도달했습니다. 더 이상 처리하지 않습니다.`);
          break; // 최대 처리 수에 도달하면 루프 종료
        }

        const newItem = await processItem(item);
        if (newItem) {
          // 신규 아이템을 기존 캐시의 첫 번째로 삽입
          await saveCache(store, [newItem], true); // 기존 데이터와 합치기
        }
        processedCount++; // 처리된 아이템 수 증가
      }
    }

    // 캐시 정리 및 저장
    const currentTime = Date.now();
    const filteredItems = processedItems.filter(item => {
      const itemTime = new Date(item.pubDate).getTime();
      return (currentTime - itemTime) < (CACHE_TTL_DAY * 24 * 60 * 60 * 1000); // 7일보다 큰 경우 제거
    });

    console.log(`최근 items 필터 수: ${filteredItems.length}`); // filteredItems 길이 로그

    // id와 pubDate가 같은 아이템 중복 제거
    const uniqueItems = Array.from(new Set(filteredItems.map(item => `${item.id}|${item.pubDate}`)))
      .map(id => filteredItems.find(item => `${item.id}|${item.pubDate}` === id));

    console.log(`중복 제거된 items 수: ${uniqueItems.length}`); // uniqueItems 길이 로그

    // pubDate 기준으로 최신 정보가 맨 앞에 오도록 정렬
    uniqueItems.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

    // 캐시 정리 및 저장 조건: filteredItems와 processedItems의 카운트가 다르거나 filteredItems에 중복이 있을 경우
    let isCached = true; // 기본값을 true로 설정
    if (uniqueItems.length !== filteredItems.length || uniqueItems.length !== processedItems.length) {
      console.log(`캐시 저장 조건 충족: uniqueItems.length = ${uniqueItems.length}, filteredItems.length = ${filteredItems.length}, processedItems.length = ${processedItems.length}`);
      // 정리한 내용을 캐시에 저장
      await saveCache(store, uniqueItems, false); // 주어진 데이터만 저장
      isCached = false; // saveCache를 호출한 경우 isCached를 false로 설정
    }

    // 캐시된 아이템을 핸들러에서 반환
    console.log(`총 캐시된 아이템 수: ${uniqueItems.length}`);
    const lastUpdated = await store.get(CACHE_KEY) ? JSON.parse(await store.get(CACHE_KEY)).timestamp : '정보 없음'; // 캐시 타임스탬프 가져오기

    return {
      statusCode: 200,
      body: JSON.stringify({
        items: uniqueItems,
        meta: {
          isCached: isCached, // saveCache 호출 여부에 따라 isCached 설정
          lastUpdated: lastUpdated, // 캐시 타임스탬프를 직접 사용
          itemCount: uniqueItems.length,
        },
      }),
    };

    //console.log('=== Function completed ===');
  } catch (error) {
    console.error('Error in handler:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal Server Error' }),
    };
  }
};
