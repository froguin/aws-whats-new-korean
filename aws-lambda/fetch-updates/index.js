import { DynamoDBClient, GetItemCommand, PutItemCommand, ScanCommand, DeleteItemCommand } from "@aws-sdk/client-dynamodb";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import rssToJson from 'rss-to-json';

const { parse } = rssToJson;

// AWS 클라이언트 초기화
const dynamoClient = new DynamoDBClient({});
const bedrockClient = new BedrockRuntimeClient({});

const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE;
const CACHE_DURATION = 30 * 24 * 60 * 60 * 1000; // 30일
const MAX_ITEMS_TO_PROCESS = 30; // 최대 처리할 항목 수

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

        // EventBridge 배치 처리 요청인지 확인
        const isBatchRequest = event.source === 'eventbridge' && event.action === 'batch';
        
        if (isBatchRequest) {
            console.log('배치 처리 시작...');
            await performBatchProcessing();
            return {
                statusCode: 200,
                body: JSON.stringify({ message: 'Batch processing completed' })
            };
        }

        // 일반 API 요청 처리
        console.log('API 요청 처리 시작...');
        
        // 캐시된 데이터 먼저 확인
        const cachedItems = await getCachedItems();
        
        if (cachedItems.length > 0) {
            console.log(`캐시된 데이터 반환: ${cachedItems.length}개 아이템`);
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    items: cachedItems,
                    meta: {
                        isCached: true,
                        lastUpdated: new Date().toISOString(),
                        itemCount: cachedItems.length
                    }
                })
            };
        }

        // 캐시가 없는 경우에만 RSS 처리
        console.log('캐시가 없어 RSS 피드 처리 시작...');
        const processedItems = await processRSSFeed();

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

// 배치 처리 함수
async function performBatchProcessing() {
    try {
        console.log('배치 처리: 오래된 데이터 정리 시작');
        await cleanupOldItems();
        
        console.log('배치 처리: 새로운 데이터 업데이트 시작');
        await processRSSFeed(true); // 배치 모드로 실행
        
        console.log('배치 처리 완료');
    } catch (error) {
        console.error('배치 처리 중 오류:', error);
        throw error;
    }
}

// RSS 피드 처리 함수
async function processRSSFeed(isBatchMode = false) {
    console.log('RSS 피드 가져오는 중...');
    const rssData = await parse('https://aws.amazon.com/about-aws/whats-new/recent/feed/');
    
    if (!rssData || !rssData.items) {
        throw new Error('RSS 데이터를 가져올 수 없습니다.');
    }

    console.log(`RSS에서 ${rssData.items.length}개 아이템 발견`);

    // 최근 30개 아이템만 처리
    const recentItems = rssData.items.slice(0, MAX_ITEMS_TO_PROCESS);
    const processedItems = [];

    for (const item of recentItems) {
        try {
            const itemId = generateItemId(item.link);
            
            // DynamoDB에서 기존 아이템 확인
            const existingItem = await getItemFromDynamoDB(itemId);
            
            if (existingItem && existingItem.koreanSummary && !isBatchMode) {
                // 이미 한글 요약이 있고 배치 모드가 아닌 경우 그대로 사용
                processedItems.push(formatItemForResponse(existingItem, item));
            } else {
                // 새로운 아이템이거나 배치 모드인 경우 처리
                console.log(`새 아이템 처리: ${item.title}`);
                
                // Nova Micro로 한글 요약 생성
                const summaryData = await generateKoreanSummary(item.title, item.description);
                
                const processedItem = {
                    id: itemId,
                    title: item.title,
                    originalContent: item.description,
                    koreanSummary: summaryData.summary,
                    target: summaryData.target,
                    features: summaryData.features,
                    regions: summaryData.regions,
                    status: summaryData.status,
                    originalLink: item.link,
                    pubDate: new Date(item.published).toISOString(),
                    createdAt: new Date().toISOString()
                };

                // DynamoDB에 저장
                await saveItemToDynamoDB(processedItem);
                processedItems.push(formatItemForResponse(processedItem, item));
            }
        } catch (error) {
            console.error(`아이템 처리 중 오류 ${item.title}:`, error);
            // 에러가 발생한 아이템은 기본값으로 처리
            processedItems.push({
                id: generateItemId(item.link),
                title: item.title,
                date: new Date(item.published).getTime(),
                content: item.description.replace(/<[^>]*>/g, '').trim(),
                target: "모든 AWS 사용자",
                features: "자세한 내용은 원문을 참조하세요",
                regions: "지원 리전 정보 없음",
                status: "일반 공개",
                originalLink: item.link,
                originalContent: item.description
            });
        }
    }

    // 날짜순으로 정렬 (최신순)
    processedItems.sort((a, b) => b.date - a.date);
    return processedItems;
}

// 캐시된 아이템 조회
async function getCachedItems() {
    try {
        const command = new ScanCommand({
            TableName: DYNAMODB_TABLE,
            FilterExpression: '#status = :status',
            ExpressionAttributeNames: {
                '#status': 'status'
            },
            ExpressionAttributeValues: {
                ':status': { S: 'active' }
            },
            Limit: 50
        });

        const result = await dynamoClient.send(command);
        
        if (result.Items && result.Items.length > 0) {
            const items = result.Items.map(item => ({
                id: item.id.S,
                title: item.title.S,
                date: new Date(item.pubDate.S).getTime(),
                content: item.koreanSummary?.S || item.originalContent.S,
                target: item.target?.S || "모든 AWS 사용자",
                features: item.features?.S || "자세한 내용은 원문을 참조하세요",
                regions: item.regions?.S || "지원 리전 정보 없음",
                status: item.itemStatus?.S || "일반 공개",
                originalLink: item.originalLink.S,
                originalContent: item.originalContent.S
            }));

            // 날짜순으로 정렬 (최신순)
            return items.sort((a, b) => b.date - a.date);
        }
        
        return [];
    } catch (error) {
        console.error('캐시된 아이템 조회 중 오류:', error);
        return [];
    }
}

// 오래된 아이템 정리
async function cleanupOldItems() {
    try {
        const cutoffDate = new Date(Date.now() - CACHE_DURATION).toISOString();
        
        const scanCommand = new ScanCommand({
            TableName: DYNAMODB_TABLE,
            FilterExpression: 'pubDate < :cutoffDate',
            ExpressionAttributeValues: {
                ':cutoffDate': { S: cutoffDate }
            }
        });

        const result = await dynamoClient.send(scanCommand);
        
        if (result.Items && result.Items.length > 0) {
            console.log(`${result.Items.length}개의 오래된 아이템 삭제 중...`);
            
            for (const item of result.Items) {
                const deleteCommand = new DeleteItemCommand({
                    TableName: DYNAMODB_TABLE,
                    Key: {
                        id: { S: item.id.S }
                    }
                });
                
                await dynamoClient.send(deleteCommand);
            }
            
            console.log('오래된 아이템 정리 완료');
        }
    } catch (error) {
        console.error('오래된 아이템 정리 중 오류:', error);
    }
}

// 응답 형식으로 변환
function formatItemForResponse(dbItem, rssItem = null) {
    return {
        id: dbItem.id,
        title: dbItem.title,
        date: new Date(dbItem.pubDate || (rssItem ? rssItem.published : new Date())).getTime(),
        content: dbItem.koreanSummary || dbItem.originalContent,
        target: dbItem.target || "모든 AWS 사용자",
        features: dbItem.features || "자세한 내용은 원문을 참조하세요",
        regions: dbItem.regions || "지원 리전 정보 없음",
        status: dbItem.itemStatus || "일반 공개",
        originalLink: dbItem.originalLink,
        originalContent: dbItem.originalContent
    };
}

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
                target: result.Item.target?.S,
                features: result.Item.features?.S,
                regions: result.Item.regions?.S,
                itemStatus: result.Item.itemStatus?.S,
                originalLink: result.Item.originalLink.S,
                pubDate: result.Item.pubDate.S,
                createdAt: result.Item.createdAt.S
            };
        }
        
        return null;
    } catch (error) {
        console.error('DynamoDB에서 아이템 조회 중 오류:', error);
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
                koreanSummary: { S: item.koreanSummary },
                target: { S: item.target },
                features: { S: item.features },
                regions: { S: item.regions },
                itemStatus: { S: item.status },
                originalLink: { S: item.originalLink },
                createdAt: { S: item.createdAt },
                pubDate: { S: item.pubDate },
                ttl: { N: ttl.toString() },
                status: { S: 'active' }
            }
        });

        await dynamoClient.send(command);
        console.log(`DynamoDB에 아이템 저장 완료: ${item.id}`);
    } catch (error) {
        console.error('DynamoDB에 아이템 저장 중 오류:', error);
        throw error;
    }
}

// Nova Micro로 한글 요약 생성 (Netlify 버전 기반)
async function generateKoreanSummary(title, content) {
    try {
        const systemPrompt = `
다음 AWS 업데이트 내용을 분석하여 한국어로 구조화된 정보를 제공해주세요.

제목: ${title}
내용: ${content}

다음 JSON 형식으로 **한 줄**로 응답해주세요:
{"title": "한국어 제목", "summary": "3-4문장 요약 (250자 이하)", "target": "대상 사용자", "features": "주요 기능 (100자 이하)", "regions": "지원 리전", "status": "상태 (정식 출시/미리보기 등)"}

요구사항:
1. 한국어로 자연스럽게 번역
2. 기술 용어는 정확하게 유지
3. HTML 태그 제거
4. 단일 줄 JSON 형식
5. 알 수 없는 정보는 "해당 없음" 표기

예시:
{"title": "AWS Lambda 기능 개선", "summary": "AWS Lambda가 새로운 메모리 옵션과 고급 모니터링을 제공합니다.", "target": "서버리스 개발자", "features": "메모리 옵션, 모니터링", "regions": "모든 AWS 리전", "status": "정식 출시"}`;

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
        const aiResponse = responseBody.output?.message?.content?.[0]?.text || '';
        
        // JSON 파싱 시도
        try {
            const jsonMatch = aiResponse.match(/\{.*\}/);
            if (jsonMatch) {
                const parsedData = JSON.parse(jsonMatch[0]);
                return {
                    title: parsedData.title || title,
                    summary: cleanText(parsedData.summary || content),
                    target: parsedData.target || "모든 AWS 사용자",
                    features: parsedData.features || "자세한 내용은 원문을 참조하세요",
                    regions: parsedData.regions || "지원 리전 정보 없음",
                    status: parsedData.status || "일반 공개"
                };
            }
        } catch (parseError) {
            console.error('JSON 파싱 오류:', parseError);
        }

        // 파싱 실패 시 기본값 반환
        return {
            title: title,
            summary: cleanText(content),
            target: "모든 AWS 사용자",
            features: "자세한 내용은 원문을 참조하세요",
            regions: "지원 리전 정보 없음",
            status: "일반 공개"
        };

    } catch (error) {
        console.error('Nova Micro 호출 중 오류:', error);
        // 오류 시 기본값 반환
        return {
            title: title,
            summary: cleanText(content),
            target: "모든 AWS 사용자",
            features: "자세한 내용은 원문을 참조하세요",
            regions: "지원 리전 정보 없음",
            status: "일반 공개"
        };
    }
}

// 텍스트 정리 함수
function cleanText(text) {
    return text
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();
}
