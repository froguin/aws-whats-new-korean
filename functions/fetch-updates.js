import { parse } from 'rss-to-json';
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { getStore } from "@netlify/blobs";

const CACHE_KEY = 'aws-updates-v2';
const CACHE_TTL = 600; // 10분 캐시

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

    // 응답에서 summary 추출
    const summaryText = JSON.parse(parsedResponse.output.message.content[0].text).summary;

    return parseModelResponse(summaryText); // summaryText를 사용하여 파싱
  } catch (error) {
    console.error('Nova 모델 호출 중 오류:', error);
    throw error;
  }
}

// Claude 응답 파싱 함수
function parseModelResponse(responseText) {
  try {
    // 응답에서 내부 JSON 블록 찾기
    const jsonStart = responseText.indexOf('{', responseText.indexOf('"title"'));
    const jsonEnd = responseText.lastIndexOf('}');
    const jsonString = responseText.substring(jsonStart, jsonEnd + 1);

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

    // 캐시된 데이터 확인
    const cachedData = await store.get(CACHE_KEY);
    if (cachedData) {
      const parsedData = JSON.parse(cachedData);
      const cacheAge = Date.now() - new Date(parsedData.timestamp).getTime();
    
      if (cacheAge < CACHE_TTL * 1000) {
        console.log('유효한 캐시된 데이터 반환');
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          },
          body: JSON.stringify({
            items: parsedData.items,
            meta: {
              isCached: true,
              lastUpdated: parsedData.timestamp,
              itemCount: parsedData.items.length
            }
          })
        };
      } else {
        console.log('캐시 만료, 새로운 데이터 가져오기');
        await store.delete(CACHE_KEY);
      }
    }

    // RSS 피드 가져오기 및 처리
    const rss = await parse('https://aws.amazon.com/about-aws/whats-new/recent/feed/');
    console.log('전체 RSS 항목 수:', rss.items.length);

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const recentItems = rss.items.filter(item => new Date(item.published) >= oneWeekAgo);
    console.log('일주일 이내 항목 수:', recentItems.length);

    const processedItems = [];
    for (const item of recentItems) {
      console.log('처리 시작:', item.title.substring(0, 30) + '...');
      const summaryResponse = await invokeNovaLiteSummarization(item.title, item.description);
      console.log('처리 완료:', item.title.substring(0, 30) + '...');

      processedItems.push({
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
        originalLink: item.link || ''
      });
    }

    // 새로운 데이터 캐시 저장
    const cacheData = {
      timestamp: new Date().toISOString(),
      items: processedItems
    };
    await store.set(CACHE_KEY, JSON.stringify(cacheData), { ttl: CACHE_TTL });
    console.log('새로운 데이터 캐시 저장 완료');

    console.log('=== Function completed ===');
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        items: processedItems,
        meta: {
          isCached: false,
          lastUpdated: cacheData.timestamp,
          itemCount: processedItems.length
        }
      })
    };
  } catch (error) {
    console.error('Function error:', error.message);
    console.error('Error stack:', error.stack);
    
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: '서버 오류가 발생했습니다',
        details: error.message 
      })
    };
  }
};