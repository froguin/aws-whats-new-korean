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
        const forceRefresh = event.queryStringParameters?.refresh === 'true';
        
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
        
        // 강제 새로고침이 아닌 경우 캐시된 데이터 먼저 확인
        if (!forceRefresh) {
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
        }

        // 캐시가 없거나 강제 새로고침인 경우 RSS 처리
        console.log('RSS 피드 처리 시작...');
        const processedItems = await processRSSFeed(forceRefresh);

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
        console.log('=== 배치 처리 시작 ===');
        const startTime = Date.now();
        
        console.log('1단계: 오래된 데이터 정리 시작');
        await cleanupOldItems();
        
        console.log('2단계: 모든 RSS 아이템 처리 시작');
        const processedItems = await processRSSFeed(true); // 배치 모드로 실행
        
        const endTime = Date.now();
        const duration = Math.round((endTime - startTime) / 1000);
        
        console.log(`=== 배치 처리 완료 ===`);
        console.log(`- 처리 시간: ${duration}초`);
        console.log(`- 총 아이템 수: ${processedItems.length}개`);
        console.log(`- 완료 시각: ${new Date().toISOString()}`);
        
        return {
            success: true,
            duration: duration,
            itemCount: processedItems.length,
            completedAt: new Date().toISOString()
        };
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

    // 배치 모드일 때는 모든 아이템 처리, 일반 모드일 때는 최근 30개만
    const itemsToProcess = isBatchMode ? rssData.items : rssData.items.slice(0, MAX_ITEMS_TO_PROCESS);
    const processedItems = [];
    let processedCount = 0;
    let skippedCount = 0;

    console.log(`처리할 아이템 수: ${itemsToProcess.length} (배치 모드: ${isBatchMode})`);

    for (const item of itemsToProcess) {
        try {
            const itemId = generateItemId(item.link);
            
            // DynamoDB에서 기존 아이템 확인
            const existingItem = await getItemFromDynamoDB(itemId);
            
            if (existingItem && existingItem.translations?.ko && !isBatchMode) {
                // 이미 한국어 번역이 있고 일반 모드인 경우 그대로 사용
                processedItems.push(formatItemForResponse(existingItem, item));
                skippedCount++;
            } else if (existingItem && existingItem.translations?.ko && isBatchMode) {
                // 배치 모드에서도 이미 번역된 아이템은 스킵 (중복 처리 방지)
                processedItems.push(formatItemForResponse(existingItem, item));
                skippedCount++;
            } else {
                // 새로운 아이템이거나 번역이 없는 경우 처리
                console.log(`새 아이템 처리 중 (${processedCount + 1}/${itemsToProcess.length}): ${item.title}`);
                
                // Nova Micro로 다국어 번역 생성
                const translations = await generateMultilingualContent(item.title, item.description);
                
                const processedItem = {
                    id: itemId,
                    title: item.title,
                    originalContent: item.description,
                    translations: translations,
                    originalLink: item.link,
                    pubDate: new Date(item.published).toISOString(),
                    createdAt: new Date().toISOString()
                };

                // DynamoDB에 저장
                await saveItemToDynamoDB(processedItem);
                processedItems.push(formatItemForResponse(processedItem, item));
                processedCount++;
                
                // 배치 모드에서 API 호출 제한을 위한 지연
                if (isBatchMode && processedCount % 5 === 0) {
                    console.log(`${processedCount}개 처리 완료, 2초 대기...`);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
        } catch (error) {
            console.error(`아이템 처리 중 오류 ${item.title}:`, error);
            // 에러가 발생한 아이템은 기본값으로 처리
            processedItems.push({
                id: generateItemId(item.link),
                title: item.title,
                date: new Date(item.published).toLocaleDateString('ko-KR', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                }),
                content: item.description.replace(/<[^>]*>/g, '').trim(),
                target: "모든 AWS 사용자",
                features: "자세한 내용은 원문을 참조하세요",
                regions: "해당 없음",
                status: "정식 출시",
                originalLink: item.link
            });
        }
    }

    console.log(`처리 완료 - 새로 번역: ${processedCount}개, 기존 사용: ${skippedCount}개, 총: ${processedItems.length}개`);

    // 날짜순으로 정렬 (최신순)
    processedItems.sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0));
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
            const items = result.Items.map(item => {
                const translations = item.translations?.M || {};
                const koTranslation = translations.ko?.M || {};
                
                return {
                    id: item.id.S,
                    title: koTranslation.title?.S || item.title.S,
                    date: new Date(item.pubDate.S).toLocaleDateString('ko-KR', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                    }),
                    content: koTranslation.summary?.S || item.originalContent.S.replace(/<[^>]*>/g, '').trim(),
                    target: koTranslation.target?.S || "모든 AWS 사용자",
                    features: koTranslation.features?.S || "자세한 내용은 원문을 참조하세요",
                    regions: koTranslation.regions?.S || "지원 리전 정보 없음",
                    status: koTranslation.status?.S || "일반 공개",
                    originalLink: item.originalLink.S,
                    pubDate: item.pubDate.S
                };
            });

            // 날짜순으로 정렬 (최신순)
            return items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
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
    const translations = dbItem.translations || {};
    const koTranslation = translations.ko || {};
    
    return {
        id: dbItem.id,
        title: koTranslation.title || dbItem.title,
        date: new Date(dbItem.pubDate || (rssItem ? rssItem.published : new Date())).toLocaleDateString('ko-KR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        }),
        content: koTranslation.summary || dbItem.originalContent.replace(/<[^>]*>/g, '').trim(),
        target: koTranslation.target || "모든 AWS 사용자",
        features: koTranslation.features || "자세한 내용은 원문을 참조하세요",
        regions: koTranslation.regions || "지원 리전 정보 없음",
        status: koTranslation.status || "일반 공개",
        originalLink: dbItem.originalLink,
        pubDate: dbItem.pubDate
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
            const translations = {};
            if (result.Item.translations?.M) {
                Object.keys(result.Item.translations.M).forEach(lang => {
                    const langData = result.Item.translations.M[lang].M;
                    translations[lang] = {};
                    Object.keys(langData).forEach(key => {
                        translations[lang][key] = langData[key].S;
                    });
                });
            }
            
            return {
                id: result.Item.id.S,
                title: result.Item.title.S,
                originalContent: result.Item.originalContent.S,
                translations: translations,
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

// DynamoDB에 아이템 저장 (다국어 지원)
async function saveItemToDynamoDB(item) {
    try {
        const ttl = Math.floor((Date.now() + CACHE_DURATION) / 1000);
        
        // 다국어 번역 데이터 구조화
        const translationsMap = {};
        Object.keys(item.translations).forEach(lang => {
            const langData = item.translations[lang];
            translationsMap[lang] = {
                M: {
                    title: { S: langData.title },
                    summary: { S: langData.summary },
                    target: { S: langData.target },
                    features: { S: langData.features },
                    regions: { S: langData.regions },
                    status: { S: langData.status }
                }
            };
        });
        
        const command = new PutItemCommand({
            TableName: DYNAMODB_TABLE,
            Item: {
                id: { S: item.id },
                title: { S: item.title },
                originalContent: { S: item.originalContent },
                translations: { M: translationsMap },
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

// Nova Micro로 다국어 번역 생성 (Micro 모델 최적화)
async function generateMultilingualContent(title, content) {
    try {
        // HTML 태그 제거 및 텍스트 정리
        const cleanContent = cleanText(content);
        
        // Nova Micro에 최적화된 단계별 프롬프트
        const systemPrompt = `당신은 AWS 기술 문서 번역 전문가입니다.

**작업**: 다음 AWS 업데이트를 한국어로 번역하고 구조화하세요.

**원문 제목**: ${title}
**원문 내용**: ${cleanContent.substring(0, 800)}

**번역 규칙**:
1. AWS 서비스명은 영문 그대로 유지 (예: Amazon S3, AWS Lambda)
2. 기술 용어는 정확히 번역 (예: region → 리전, instance → 인스턴스)
3. 마케팅 문구보다 기술적 사실에 집중
4. 간결하고 명확하게 표현

**출력 형식**: 정확히 다음 JSON 형식으로만 응답하세요.
{"title":"한국어_제목","summary":"핵심_내용_요약_3문장_이내","target":"주요_대상_사용자","features":"핵심_기능_또는_변경사항","regions":"지원_리전_정보","status":"출시_상태"}

**필드별 가이드**:
- title: 제목을 자연스러운 한국어로 번역
- summary: 무엇이 새로워졌는지, 어떤 이점이 있는지 3문장 이내로 요약
- target: 누가 사용할지 (예: "개발자", "데이터 엔지니어", "모든 사용자")
- features: 주요 기능이나 개선사항을 간단히 (예: "새로운 API", "성능 향상")
- regions: 어느 리전에서 사용 가능한지 (모르면 "해당 없음")
- status: "정식 출시", "미리보기", "베타" 중 하나

**예시**:
{"title":"Amazon S3 새로운 스토리지 클래스 출시","summary":"Amazon S3에서 비용 효율적인 새로운 스토리지 클래스를 제공합니다. 자주 액세스하지 않는 데이터의 비용을 최대 40% 절감할 수 있습니다. 기존 S3 API와 완전 호환됩니다.","target":"모든 AWS 사용자","features":"새로운 스토리지 클래스, 비용 절감","regions":"모든 AWS 리전","status":"정식 출시"}`;

        const params = {
            modelId: 'apac.amazon.nova-micro-v1:0',
            contentType: 'application/json',
            accept: 'application/json',
            body: JSON.stringify({
                schemaVersion: "messages-v1",
                messages: [{ role: "user", content: [{ text: systemPrompt }] }],
                inferenceConfig: {
                    maxTokens: 800,
                    temperature: 0.1,  // 더 일관된 결과를 위해 낮춤
                    topP: 0.9
                }
            })
        };

        const command = new InvokeModelCommand(params);
        const response = await bedrockClient.send(command);
        
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        const aiResponse = responseBody.output?.message?.content?.[0]?.text || '';
        
        console.log('Nova Micro 응답:', aiResponse);
        
        // JSON 파싱 시도 (더 관대한 파싱)
        try {
            // 먼저 전체 응답에서 JSON 찾기
            let jsonMatch = aiResponse.match(/\{[^}]*"title"[^}]*\}/);
            if (!jsonMatch) {
                // 더 넓은 범위로 JSON 찾기
                jsonMatch = aiResponse.match(/\{.*?\}/s);
            }
            
            if (jsonMatch) {
                let jsonStr = jsonMatch[0];
                // 일반적인 JSON 정리
                jsonStr = jsonStr
                    .replace(/[\n\r\t]/g, ' ')
                    .replace(/\s+/g, ' ')
                    .replace(/,\s*}/g, '}')
                    .trim();
                
                console.log('파싱할 JSON:', jsonStr);
                const parsedData = JSON.parse(jsonStr);
                
                return {
                    ko: {
                        title: parsedData.title || title,
                        summary: cleanText(parsedData.summary || content),
                        target: parsedData.target || "모든 AWS 사용자",
                        features: parsedData.features || "자세한 내용은 원문을 참조하세요",
                        regions: parsedData.regions || "해당 없음",
                        status: parsedData.status || "정식 출시"
                    }
                };
            }
        } catch (parseError) {
            console.error('JSON 파싱 오류:', parseError);
            console.error('파싱 시도한 텍스트:', aiResponse);
        }

        // 파싱 실패 시 기본값 반환
        return {
            ko: {
                title: title,
                summary: cleanText(content),
                target: "모든 AWS 사용자",
                features: "자세한 내용은 원문을 참조하세요",
                regions: "지원 리전 정보 없음",
                status: "일반 공개"
            }
        };

    } catch (error) {
        console.error('Nova Micro 호출 중 오류:', error);
        // 오류 시 기본값 반환
        return {
            ko: {
                title: title,
                summary: cleanText(content),
                target: "모든 AWS 사용자",
                features: "자세한 내용은 원문을 참조하세요",
                regions: "지원 리전 정보 없음",
                status: "일반 공개"
            }
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
