import { parse } from 'rss-to-json';
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { getStore } from "@netlify/blobs";
import fetch from 'node-fetch'; // node-fetch를 가져옵니다.
import async from 'async';

const CACHE_KEY_PREFIX = 'aws-updates-';
const CACHE_TTL = 604800; // 7일 캐시 (초 단위)

// 클라이언트를 최상위 범위에서 생성
const bedrockClient = new BedrockRuntimeClient({
  region: process.env.CUSTOM_AWS_REGION,
  credentials: {
    accessKeyId: process.env.CUSTOM_AWS_ACCESS_KEY,
    secretAccessKey: process.env.CUSTOM_AWS_SECRET_KEY
  }
});

const queue = async.queue(async (task, callback) => {
  try {
    const result = await task.fn(task.title, task.description);
    callback(null, result);
  } catch (error) {
    callback(error);
  }
}, 2); // 동시에 2개의 요청만 처리

async function queuedInvokeSummarization(title, description) {
  return new Promise((resolve, reject) => {
    queue.push({fn: invokeClaudeSummarization, title, description}, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
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
      messages: [{ role: "user", content: prompt }]
    })
  };

  try {
    const command = new InvokeModelCommand(params);
    const response = await bedrockClient.send(command);
    const decodedResponseBody = new TextDecoder().decode(response.body);
    const parsedResponse = JSON.parse(decodedResponseBody);
    return JSON.parse(parsedResponse.content[0].text); // JSON 형식으로 반환
  } catch (error) {
    console.error('Claude 모델 호출 중 오류:', error);
    throw error;
  }
}

// NovaLite 모델을 사용한 요약 및 번역 함수
async function invokeNovaLiteSummarization(title, description) {
  const prompt = generateSystemPrompt(title, description);
  const params = {
    modelId: 'us.amazon.nova-lite-v1:0',
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      schemaVersion: "messages-v1",
      messages: [
        {
          role: "user",
          content: [{ text: `Title: ${title}\nDescription: ${description}` }]
        }
      ],
      system: [
        {
          text: prompt
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
    // 응답의 body를 직접 확인하고 JSON으로 파싱
    const decodedResponseBody = new TextDecoder().decode(response.body);
    const parsedResponse = JSON.parse(decodedResponseBody);
    
    return parsedResponse; // JSON 형식으로 반환
  } catch (error) {
    console.error('NovaLite 모델 호출 중 오류:', error);
    throw error;
  }
}

// Upstage Solar Pro 모델을 사용한 요약 및 번역 함수
async function invokeSolarProSummarization(title, description) {
  const prompt = generateSystemPrompt(title, description);
  const apiKey = process.env.UPSTAGE_API_KEY; // 환경변수에서 API 키를 가져옵니다.
  const response = await fetch('https://api.upstage.ai/v1/solar/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: "solar-pro",
      messages: [
        {
          role: "user",
          content: prompt // 시스템 프롬프트를 사용합니다.
        }
      ],
      stream: false // 스트리밍을 끕니다.
    })
  });

  if (!response.ok) {
    throw new Error(`Solar Pro 모델 호출 실패: ${response.statusText}`);
  }

  const responseData = await response.json(); // JSON 형식으로 응답을 파싱합니다.
  return responseData; // 응답을 반환합니다.
}

export const handler = async () => {
  const store = getStore({
    name: "aws-updates-store",
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_ACCESS_TOKEN
  });

  try {
    const rssFeed = await parse('https://aws.amazon.com/about-aws/whats-new/recent/feed/');
    const now = Date.now();
    const processedItems = await Promise.all(rssFeed.items.map(async (item) => {
      const itemDate = new Date(item.pubDate).getTime();
      if (now - itemDate > CACHE_TTL * 1000) return null; // 7일 이상된 아이템은 무시

      // Solar Pro 모델을 사용하여 요약 및 번역
      const summaryResponse = await queuedInvokeSummarization(item.title, item.description);
      const cacheKey = `${CACHE_KEY_PREFIX}${item.guid}`;

      // 캐시 데이터 구조를 시스템 프롬프트의 예제 JSON에 맞춤
      const cacheData = {
        title: summaryResponse.title || '제목 없음',
        summary: summaryResponse.summary || '내용 없음',
        target: summaryResponse.target || "모든 AWS 사용자",
        features: summaryResponse.features || "자세한 내용은 원문을 참조하세요",
        regions: summaryResponse.regions || "지원 리전 정보 없음",
        status: summaryResponse.status || "알 수 없음",
        originalLink: item.link,
        date: item.pubDate
      };

      await store.set(cacheKey, JSON.stringify(cacheData), { ttl: CACHE_TTL });

      return {
        guid: item.guid,
        ...cacheData // 캐시 데이터 구조를 반환
      };
    }));

    return {
      statusCode: 200,
      body: JSON.stringify(processedItems.filter(Boolean)),
    };
  } catch (error) {
    console.error('Function error:', error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: '서버 오류가 발생했습니다', details: error.message }),
    };
  }
}; 