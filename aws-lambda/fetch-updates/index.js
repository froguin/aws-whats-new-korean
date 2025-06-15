import { DynamoDBClient, GetItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import rssToJson from 'rss-to-json';

const { parse } = rssToJson;

// AWS 클라이언트 초기화 (리전은 자동으로 감지됨)
const dynamoClient = new DynamoDBClient({});
const bedrockClient = new BedrockRuntimeClient({});

const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE;
const CACHE_DURATION = 30 * 24 * 60 * 60 * 1000; // 30일

export const handler = async (event) => {
    console.log('Event:', JSON.stringify(event, null, 2));
    
    try {
        // CORS 헤더
        const headers = {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
        };

        // OPTIONS 요청 처리
        if (event.httpMethod === 'OPTIONS') {
            return {
                statusCode: 200,
                headers,
                body: ''
            };
        }

        // RSS 피드 파싱
        console.log('Fetching RSS feed...');
        const rssData = await parse('https://aws.amazon.com/about-aws/whats-new/recent/feed/');
        
        if (!rssData || !rssData.items) {
            throw new Error('RSS 데이터를 가져올 수 없습니다.');
        }

        console.log(`Found ${rssData.items.length} items in RSS feed`);

        // 최신 30개 아이템만 처리
        const recentItems = rssData.items.slice(0, 30);
        const processedItems = [];

        for (const item of recentItems) {
            try {
                const itemId = generateItemId(item.link);
                
                // DynamoDB에서 기존 아이템 확인
                const existingItem = await getItemFromDynamoDB(itemId);
                
                if (existingItem && existingItem.koreanSummary) {
                    // 이미 한글 요약이 있는 경우 그대로 사용
                    processedItems.push({
                        id: itemId,
                        title: existingItem.title,
                        date: new Date(item.published).getTime(),
                        content: existingItem.koreanSummary,
                        originalLink: item.link,
                        originalContent: existingItem.originalContent
                    });
                } else {
                    // 새로운 아이템이거나 한글 요약이 없는 경우
                    console.log(`Processing new item: ${item.title}`);
                    
                    // Nova Micro로 한글 요약 생성
                    const koreanSummary = await generateKoreanSummary(item.title, item.description);
                    
                    const processedItem = {
                        id: itemId,
                        title: item.title,
                        date: new Date(item.published).getTime(),
                        content: koreanSummary,
                        originalLink: item.link,
                        originalContent: item.description
                    };

                    // DynamoDB에 개별 아이템 저장
                    await saveItemToDynamoDB(processedItem);
                    processedItems.push(processedItem);
                }
            } catch (error) {
                console.error(`Error processing item ${item.title}:`, error);
                // 에러가 발생한 아이템은 원문 그대로 사용
                processedItems.push({
                    id: generateItemId(item.link),
                    title: item.title,
                    date: new Date(item.published).getTime(),
                    content: item.description,
                    originalLink: item.link,
                    originalContent: item.description
                });
            }
        }

        // 날짜순으로 정렬 (최신순)
        processedItems.sort((a, b) => b.date - a.date);

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
        console.error('Error:', error);
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                error: 'Internal Server Error',
                message: error.message
            })
        };
    }
};

// 아이템 ID 생성 함수
function generateItemId(link) {
    return Buffer.from(link).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 50);
}

// DynamoDB에서 아이템 조회
async function getItemFromDynamoDB(itemId) {
    try {
        const command = new GetItemCommand({
            TableName: DYNAMODB_TABLE,
            Key: {
                id: { S: itemId }
            }
        });

        const result = await dynamoClient.send(command);
        
        if (result.Item) {
            return {
                id: result.Item.id.S,
                title: result.Item.title.S,
                originalContent: result.Item.originalContent.S,
                koreanSummary: result.Item.koreanSummary?.S,
                createdAt: result.Item.createdAt.S
            };
        }
        
        return null;
    } catch (error) {
        console.error('Error getting item from DynamoDB:', error);
        return null;
    }
}

// DynamoDB에 아이템 저장
async function saveItemToDynamoDB(item) {
    try {
        const ttl = Math.floor((Date.now() + CACHE_DURATION) / 1000);
        
        const command = new PutItemCommand({
            TableName: DYNAMODB_TABLE,
            Item: {
                id: { S: item.id },
                title: { S: item.title },
                originalContent: { S: item.originalContent },
                koreanSummary: { S: item.content },
                originalLink: { S: item.originalLink },
                createdAt: { S: new Date().toISOString() },
                ttl: { N: ttl.toString() },
                status: { S: 'active' },
                pubDate: { S: new Date(item.date).toISOString() }
            }
        });

        await dynamoClient.send(command);
        console.log(`Saved item to DynamoDB: ${item.id}`);
    } catch (error) {
        console.error('Error saving item to DynamoDB:', error);
        throw error;
    }
}

// Nova Micro로 한글 요약 생성
async function generateKoreanSummary(title, content) {
    try {
        const systemPrompt = `다음 AWS 업데이트 내용을 한국어로 요약해주세요. 기술적인 내용을 정확하게 전달하면서도 이해하기 쉽게 작성해주세요.

제목: ${title}
내용: ${content}

요구사항:
1. 한국어로 자연스럽게 번역
2. 기술 용어는 정확하게 유지
3. 2-3문장으로 핵심 내용 요약
4. HTML 태그는 제거하고 순수 텍스트로 작성
5. 마케팅 문구보다는 기술적 사실에 집중

한글 요약:`;

        const params = {
            modelId: 'apac.amazon.nova-micro-v1:0',
            contentType: 'application/json',
            accept: 'application/json',
            body: JSON.stringify({
                schemaVersion: "messages-v1",
                messages: [{ role: "user", content: [{ text: systemPrompt }] }],
                inferenceConfig: {
                    maxTokens: 500,
                    temperature: 0.3
                }
            })
        };

        const command = new InvokeModelCommand(params);
        const response = await bedrockClient.send(command);
        
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        const summary = responseBody.output?.message?.content?.[0]?.text || content;
        
        // HTML 태그 제거 및 정리
        return summary
            .replace(/<[^>]*>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .trim();

    } catch (error) {
        console.error('Error generating Korean summary:', error);
        // Nova Micro 호출 실패 시 원문 반환
        return content.replace(/<[^>]*>/g, '').trim();
    }
}
