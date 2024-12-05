import { parse } from 'rss-to-json';
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { getStore } from "@netlify/blobs";

const CACHE_KEY = 'aws-updates-v2';
const CACHE_TTL_DAY = 7; // 7일간 정보 유지
const MAX_ITEMS_TO_PROCESS = 3; // 최대 처리할 항목 수

// 클라이언트를 최상위 범위에서 생성
const bedrockClient = new BedrockRuntimeClient({
  region: process.env.CUSTOM_AWS_REGION,
  credentials: {
    accessKeyId: process.env.CUSTOM_AWS_ACCESS_KEY,
    secretAccessKey: process.env.CUSTOM_AWS_SECRET_KEY
  }
});

// Claude 모델을 사용한 요약 및 번역 함수
async function invokeClaudeSummarization(title, description) {
  const prompt = generateSystemPrompt(title, description);

  const params = {
    modelId: 'us.anthropic.claude-3-5-haiku-20241022-v1:0',
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 1000,
      messages: [
        {
          role: "user",
          content: prompt
        }
      ]
    })
  };

  try {
    const command = new InvokeModelCommand(params);
    const response = await bedrockClient.send(command);
    const decodedResponseBody = new TextDecoder().decode(response.body);
    const parsedResponse = JSON.parse(decodedResponseBody);
    
    return parseModelResponse(parsedResponse.content[0].text);
  } catch (error) {
    console.error('Claude 모델 호출 중 오류:', error);
    throw error;
  }
}

async function invokeNovaLiteSummarization(title, description) {
  const systemPrompt = generateSystemPrompt();
  const userPrompt = `Title: ${title}\nDescription: ${description}`;
  
  const params = {
    modelId: 'us.amazon.nova-lite-v1:0',
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      schemaVersion: "messages-v1",
      messages: [
        {
          role: "user",
          content: [{ text: userPrompt }]
        }
      ],
      system: [
        {
          text: systemPrompt
        }
      ],
      inferenceConfig: {
        max_new_tokens: 1000,
        top_p: 0.9,
        top_k: 20,
        temperature: 0.7
      }
    })
  };

  try {
    const command = new InvokeModelCommand(params);
    const response = await bedrockClient.send(command);
    const decodedResponseBody = new TextDecoder().decode(response.body);

    console.log('응답 본문:', decodedResponseBody); // 응답 본문 로그 출력

    // 응답 본문이 비어 있지 않은지 확인
    if (!decodedResponseBody) {
      throw new Error('응답 본문이 비어 있습니다.');
    }

    const parsedResponse = JSON.parse(decodedResponseBody);

    // 응답 구조에 맞게 수정
    if (!parsedResponse.output || !parsedResponse.output.message || !Array.isArray(parsedResponse.output.message.content) || parsedResponse.output.message.content.length === 0) {
      throw new Error('유효한 content가 응답에 포함되어 있지 않습니다.');
    }

    // 응답에서 JSON 문자열 추출
    const jsonString = parsedResponse.output.message.content[0].text;

    // JSON 파싱
    let summaryData;
    try {
      summaryData = JSON.parse(jsonString);
    } catch (error) {
      throw new Error('JSON 파싱 오류: ' + error.message);
    }

    // summaryData에서 필요한 정보 추출
    return parseModelResponse(summaryData); // summaryData를 사용하여 파싱
  } catch (error) {
    console.error('Nova 모델 호출 중 오류:', error);
    throw error;
  }
}

// Claude 응답 파싱 함수
function parseModelResponse(responseText) {
  try {
    // 응답에서 내부 JSON 블록 찾기
    const responseString = typeof responseText === 'string' ? responseText : JSON.stringify(responseText);
    
    const jsonStart = responseString.indexOf('{', responseString.indexOf('"title"'));
    const jsonEnd = responseString.lastIndexOf('}');
    const jsonString = responseString.substring(jsonStart, jsonEnd + 1);

    // 불필요한 문자 정리
    const cleanedJson = jsonString
      .replace(/\\n/g, ' ')          // 줄바꿈 제거
      .replace(/\\t/g, ' ')          // 탭 제거
      .replace(/\s{2,}/g, ' ')       // 중복 공백 제거
      .replace(/\\\\"/g, '"')        // 이중 이스케이프된 따옴표 제거
      .replace(/\\'/g, "'")          // 이스케이프된 작은따옴표 제거
      .trim();

    // JSON 파싱
    const parsedResponse = JSON.parse(cleanedJson);

    // content 필드에 중첩된 JSON이 있다면 추가로 파싱 시도
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
    // 기본 폴백 응답
    return {
      title: '파싱 오류 발생',
      summary: responseText
    };
  }
}

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
  const cacheData = {
    timestamp: new Date().toISOString(),
    items: items
  };
  await store.set(CACHE_KEY, JSON.stringify(cacheData));
}

// 아이템 처리 함수
async function processItem(item, processedItems, existingItemsSet) {
  const itemGuid = item.guid ? String(item.guid) : 'unknown-guid'; // guid가 없을 경우 기본값 설정
  const itemPubDate = new Date(item.published).toISOString(); // pubDate를 ISO 문자열로 변환

  // 기존 아이템과 비교하여 새로운 아이템인지 확인
  if (!existingItemsSet.has(`${itemGuid}|${itemPubDate}`)) {
    try {
      console.log('처리 시작:', item.title.substring(0, 30) + '...');
      const summaryResponse = await invokeNovaLiteSummarization(item.title, item.description);
      console.log('처리 완료:', item.title.substring(0, 30) + '...');

      // 새로운 아이템을 맨 앞에 추가
      processedItems.unshift({
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
        guid: itemGuid, // guid 추가
        pubDate: itemPubDate // pubDate를 ISO 문자열로 저장
      });

      return true; // 처리 성공
    } catch (error) {
      console.error('아이템 처리 중 오류:', error);
      return false; // 처리 실패
    }
  } else {
    console.log(`기존 아이템 ${itemGuid} (${item.title})는 이미 처리되었습니다.`);
    return false; // 이미 처리된 아이템
  }
}

// RSS 피드에서 최근 아이템 필터링 함수
function filterRecentItems(rssItems) {
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  return rssItems.filter(item => new Date(item.published) >= oneWeekAgo);
}

export const handler = async () => {
  try {
    console.log('=== Function started ===');
    
    // 환경변수 체크
    const requiredEnvVars = [
      'CUSTOM_AWS_ACCESS_KEY', 
      'CUSTOM_AWS_SECRET_KEY', 
      'CUSTOM_AWS_REGION', 
      'NETLIFY_SITE_ID', 
      'NETLIFY_ACCESS_TOKEN'
    ];
    
    requiredEnvVars.forEach(varName => {
      if (!process.env[varName]) {
        throw new Error(`Required environment variable ${varName} is missing`);
      }
    });

    console.log('환경변수 확인 완료');

    // Blob 스토어 초기화
    const store = getStore({
      name: "aws-updates-store",
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_ACCESS_TOKEN
    });

    // 캐시에서 기존 데이터 가져오기
    const cachedData = await store.get(CACHE_KEY);
    const processedItems = cachedData ? JSON.parse(cachedData).items : [];

    // RSS 피드 가져오기
    const rss = await parse('https://aws.amazon.com/about-aws/whats-new/recent/feed/');
    console.log('전체 RSS 항목 수:', rss.items.length);

    const recentItems = filterRecentItems(rss.items);
    console.log('일주일 이내 항목 수:', recentItems.length);

    // 기존 아이템의 guid와 pubDate를 Set으로 저장
    const existingItemsSet = new Set(processedItems.map(item => `${item.guid}|${item.pubDate}`));
    console.log('기존 아이템 Set:', existingItemsSet);

    // 업데이트가 필요한 항목 수
    let updateCount = 0;

    // 업데이트가 필요한 항목 수 세기
    for (const item of recentItems) {
      const itemGuid = item.guid; // RSS 피드에서 guid 가져오기
      const itemPubDate = new Date(item.published).toISOString(); // pubDate를 ISO 문자열로 변환

      // 기존 아이템과 비교하여 새로운 아이템인지 확인
      if (!existingItemsSet.has(`${itemGuid}|${itemPubDate}`)) {
        updateCount++; // 업데이트가 필요한 항목 수 증가
      }
    }

    console.log(`업데이트가 필요한 항목 수: ${updateCount}`);

    // 업데이트가 필요한 항목만 처리 (최대 3개)
    if (updateCount > 0) {
      let processedCount = 0; // 처리한 항목 수 카운터
      for (const item of recentItems) {
        if (await processItem(item, processedItems, existingItemsSet)) {
          processedCount++; // 처리한 항목 수 증가
          if (processedCount >= MAX_ITEMS_TO_PROCESS) break; // 최대 처리 수에 도달하면 종료
        }
      }
    }

    // 캐시에서 pubDate 기준으로 내림차순 정렬
    processedItems.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

    // 캐시에서 7일이 지난 아이템 삭제
    const currentTime = Date.now();
    const filteredItems = processedItems.filter(item => {
      const itemTime = new Date(item.date).getTime();
      return (currentTime - itemTime) < (CACHE_TTL_DAY * 24 * 60 * 60); // CACHE_TTL_DAY를 초 단위로 변환
    });

    // 최종 캐시 저장
    await saveCache(store, filteredItems);

    console.log('=== New items processed ===');
  } catch (error) {
    console.error('Error processing new items:', error);
  }
};