import { DynamoDBClient, GetItemCommand, PutItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { parse } from 'rss-to-json';

const RSS_URL = 'https://aws.amazon.com/about-aws/whats-new/recent/feed/';
const CACHE_KEY = 'aws-updates-v2';
const CACHE_TTL_DAY = 30;
const MAX_ITEMS_TO_PROCESS = 30;

// AWS 클라이언트 초기화
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const bedrockClient = new BedrockRuntimeClient({ region: process.env.AWS_REGION });

export const handler = async (event) => {
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    };

    try {
        // OPTIONS 요청 처리 (CORS)
        if (event.httpMethod === 'OPTIONS') {
            return {
                statusCode: 200,
                headers,
                body: ''
            };
        }

        // 캐시된 데이터 확인
        const cachedData = await getCachedData();
        if (cachedData && !isExpired(cachedData.lastUpdated)) {
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    items: cachedData.items,
                    meta: {
                        isCached: true,
                        lastUpdated: cachedData.lastUpdated,
                        itemCount: cachedData.items.length
                    }
                })
            };
        }

        // RSS 피드 파싱
        const rssData = await parse(RSS_URL);
        const items = rssData.items.slice(0, MAX_ITEMS_TO_PROCESS);
        
        // 각 항목 처리 및 번역
        const processedItems = [];
        for (const item of items) {
            try {
                const translatedItem = await processItem(item);
                processedItems.push(translatedItem);
            } catch (error) {
                console.error('항목 처리 중 오류:', error);
                // 번역 실패 시 원본 데이터 사용
                processedItems.push({
                    title: item.title,
                    date: item.published,
                    content: item.description,
                    originalLink: item.link
                });
            }
        }

        // 캐시에 저장
        await saveCachedData(processedItems);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                items: processedItems,
                meta: {
                    isCached: false,
                    lastUpdated: new Date().toISOString(),
                    itemCount: processedItems.length
                }
            })
        };

    } catch (error) {
        console.error('Lambda 함수 실행 중 오류:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: '서버 오류가 발생했습니다.',
                message: error.message
            })
        };
    }
};

async function getCachedData() {
    try {
        const command = new GetItemCommand({
            TableName: process.env.DYNAMODB_TABLE,
            Key: {
                id: { S: CACHE_KEY }
            }
        });
        
        const result = await dynamoClient.send(command);
        if (result.Item) {
            return {
                items: JSON.parse(result.Item.items.S),
                lastUpdated: result.Item.lastUpdated.S
            };
        }
        return null;
    } catch (error) {
        console.error('캐시 데이터 조회 중 오류:', error);
        return null;
    }
}

async function saveCachedData(items) {
    try {
        const ttl = Math.floor(Date.now() / 1000) + (CACHE_TTL_DAY * 24 * 60 * 60);
        
        const command = new PutItemCommand({
            TableName: process.env.DYNAMODB_TABLE,
            Item: {
                id: { S: CACHE_KEY },
                items: { S: JSON.stringify(items) },
                lastUpdated: { S: new Date().toISOString() },
                ttl: { N: ttl.toString() },
                status: { S: 'active' },
                pubDate: { S: new Date().toISOString() }
            }
        });
        
        await dynamoClient.send(command);
    } catch (error) {
        console.error('캐시 데이터 저장 중 오류:', error);
    }
}

function isExpired(lastUpdated) {
    const now = new Date();
    const updated = new Date(lastUpdated);
    const diffHours = (now - updated) / (1000 * 60 * 60);
    return diffHours > (CACHE_TTL_DAY * 24);
}

async function processItem(item) {
    const translatedData = await invokeNovaMicroSummarization(item.title, item.description);
    
    return {
        title: translatedData.title || item.title,
        date: item.published,
        content: translatedData.content || item.description,
        target: translatedData.target,
        features: translatedData.features,
        regions: translatedData.regions,
        status: translatedData.status,
        originalLink: item.link
    };
}

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
        const parsedResponse = JSON.parse(decodedResponseBody);
        
        if (parsedResponse.output?.message?.content?.[0]?.text) {
            const jsonString = parsedResponse.output.message.content[0].text;
            return JSON.parse(jsonString);
        }
        
        throw new Error('유효한 응답을 받지 못했습니다.');
    } catch (error) {
        console.error('Nova 모델 호출 중 오류:', error);
        throw error;
    }
}

function generateSystemPrompt(title, description) {
    return `다음 AWS 업데이트 정보를 한국어로 번역하고 요약해주세요.

제목: ${title}
내용: ${description}

다음 JSON 형식으로 응답해주세요:
{
  "title": "한국어로 번역된 제목",
  "content": "한국어로 번역되고 요약된 내용 (2-3문장)",
  "target": "대상 사용자나 서비스 (예: 개발자, 데이터 엔지니어 등)",
  "features": "주요 기능이나 특징",
  "regions": "사용 가능한 리전 정보",
  "status": "서비스 상태 (예: GA, Preview, Beta 등)"
}

번역 시 기술 용어는 적절히 한국어화하되, AWS 서비스명은 원문 그대로 유지해주세요.`;
}
