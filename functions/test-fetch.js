import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { getStore } from "@netlify/blobs";
import { parseStringPromise } from 'xml2js';
import fetch from 'node-fetch';

const RSS_URL = 'https://aws.amazon.com/about-aws/whats-new/recent/feed/';
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

// RSS 피드 가져오기 함수
async function fetchRss() {
  try {
    const response = await fetch(RSS_URL);
    const text = await response.text();
    const result = await parseStringPromise(text);
    
    // RSS 피드에서 item 배열을 반환
    return result.rss.channel[0].item;
  } catch (error) {
    console.error('RSS 피드 가져오기 오류:', error);
    throw error;
  }
}

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

// 모델 응답 파싱 함수
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

// 새로운 아이템 처리 함수
async function processItem(item) {
  const itemGuid = item.guid[0]; // guid를 배열에서 가져옴
  console.log('아이템 GUID:', itemGuid);
  const itemPubDate = new Date(item.pubDate[0]).toISOString(); // pubDate를 사용하여 ISO 형식으로 변환

  try {
    console.log('처리 시작:', item.title[0].substring(0, 30) + '...');
    const summaryResponse = await invokeNovaLiteSummarization(item.title[0], item.description[0]);
    console.log('처리 완료:', item.title[0].substring(0, 30) + '...');

    const newItem = {
      title: summaryResponse.title,
      date: new Date(item.pubDate[0]).toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }),
      content: summaryResponse.summary,
      target: summaryResponse.target || "모든 AWS 사용자",
      features: summaryResponse.features || "자세한 내용은 원문을 참조하세요",
      regions: summaryResponse.regions || "지원 리전 정보 없음",
      status: summaryResponse.status || "일반 공개",
      originalLink: item.link[0] || '',
      guid: itemGuid,
      pubDate: itemPubDate
    };

    return newItem;
  } catch (error) {
    console.error(`아이템 처리 중 오류 (GUID: ${itemGuid}):`, error);
    return null;
  }
}

// RSS 아이템 처리 함수
async function processRssItems() {
  const rssItems = await fetchRss();
  console.log('전체 RSS 항목 수:', rssItems.length);

  for (const item of rssItems) {
    await processItem(item); // 각 아이템 처리
  }
}

// 핸들러 함수
export const handler = async () => {
  try {
    console.log('=== Function started ===');
    
    // RSS 아이템 처리
    await processRssItems();

    console.log('=== Function completed ===');
  } catch (error) {
    console.error('Error in handler:', error);
  }
};
