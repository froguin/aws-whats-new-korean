import { DynamoDBClient, GetItemCommand, PutItemCommand, ScanCommand, DeleteItemCommand } from "@aws-sdk/client-dynamodb";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import rssToJson from 'rss-to-json';

const { parse } = rssToJson;

// AWS 클라이언트 초기화
const dynamoClient = new DynamoDBClient({});
const bedrockClient = new BedrockRuntimeClient({});

const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE;
const CACHE_DURATION = 30 * 24 * 60 * 60 * 1000; // 30일

export const handler = async (event) => {
    console.log('=== Lambda 함수 시작 ===');
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
            return { statusCode: 200, headers, body: '' };
        }

        const forceRefresh = event.queryStringParameters?.refresh === 'true';
        console.log('강제 새로고침:', forceRefresh);

        // 강제 새로고침이 아닌 경우 캐시 확인
        if (!forceRefresh) {
            console.log('캐시된 데이터 확인 중...');
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

        // RSS 피드 처리
        console.log('RSS 피드 처리 시작...');
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
        console.error('=== Lambda 함수 오류 ===');
        console.error('Error:', error);
        console.error('Stack:', error.stack);
        
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

// RSS 피드 처리 함수 (GUID 추출 개선)
async function processRSSFeed() {
    console.log('=== RSS 피드 처리 시작 ===');
    
    try {
        // RSS XML 데이터 직접 가져오기 (GUID 추출을 위해)
        console.log('RSS XML 피드 다운로드 중...');
        const xmlData = await fetchRSSXML();
        
        // rss-to-json으로 기본 파싱
        console.log('RSS 피드 파싱 중...');
        const rssData = await parse('https://aws.amazon.com/about-aws/whats-new/recent/feed/');
        
        if (!rssData || !rssData.items) {
            throw new Error('RSS 데이터를 가져올 수 없습니다.');
        }

        console.log(`RSS에서 ${rssData.items.length}개 아이템 발견`);

        // XML에서 GUID 추출
        const guidMap = extractGUIDsFromXML(xmlData);
        console.log(`XML에서 ${Object.keys(guidMap).length}개 GUID 추출`);

        const processedItems = [];
        const maxItems = 30; // 처리할 최대 아이템 수 증가

        // 최근 30개 아이템 처리
        const itemsToProcess = rssData.items.slice(0, maxItems);
        console.log(`처리할 아이템 수: ${itemsToProcess.length}개`);

        for (let i = 0; i < itemsToProcess.length; i++) {
            const item = itemsToProcess[i];
            
            // XML에서 추출한 GUID 매핑
            const itemGuid = guidMap[item.link] || '';
            
            console.log(`\n--- 아이템 ${i + 1}/${itemsToProcess.length} 처리 중 ---`);
            console.log('제목:', item.title);
            console.log('GUID:', itemGuid || '없음');
            console.log('링크:', item.link);
            
            try {
                // 고유 ID 생성 - GUID가 없으면 링크의 해시 사용
                let itemId;
                if (itemGuid) {
                    itemId = generateUniqueId(itemGuid);
                } else {
                    // 링크에서 마지막 부분을 추출하여 더 안정적인 ID 생성
                    const linkParts = item.link.split('/');
                    const lastPart = linkParts[linkParts.length - 1] || linkParts[linkParts.length - 2];
                    itemId = generateUniqueId(lastPart || item.link);
                }
                
                console.log('생성된 ID:', itemId);

                // DynamoDB에서 기존 아이템 확인
                const existingItem = await getItemFromDynamoDB(itemId);
                
                if (existingItem && existingItem.koTitle && existingItem.koTitle.length > 10) {
                    console.log('기존 번역된 아이템 사용');
                    processedItems.push(formatItemForResponse(existingItem));
                } else {
                    console.log('새 아이템 번역 시작...');
                    
                    // Nova Micro로 번역
                    const translation = await translateWithNovaMicro(item.title, item.description);
                    console.log('번역 결과 제목:', translation.title);
                    
                    // DynamoDB에 저장할 아이템 구성
                    const dbItem = {
                        id: itemId,
                        guid: itemGuid || '',
                        originalTitle: item.title,
                        originalContent: item.description,
                        koTitle: translation.title,
                        koSummary: translation.summary,
                        koTarget: translation.target,
                        koFeatures: translation.features,
                        koRegions: translation.regions,
                        koStatus: translation.status,
                        originalLink: item.link,
                        pubDate: new Date(item.published).toISOString(),
                        createdAt: new Date().toISOString()
                    };

                    // DynamoDB에 저장
                    console.log('DynamoDB에 저장 중...');
                    await saveItemToDynamoDB(dbItem);
                    
                    processedItems.push(formatItemForResponse(dbItem));
                    
                    // API 호출 제한을 위한 지연 (더 짧게)
                    if (i < itemsToProcess.length - 1) {
                        console.log('1.5초 대기...');
                        await new Promise(resolve => setTimeout(resolve, 1500));
                    }
                }
            } catch (itemError) {
                console.error(`아이템 처리 중 오류:`, itemError);
                
                // 오류 발생 시에도 기본 정보는 저장
                const fallbackId = generateUniqueId(item.link);
                const fallbackItem = {
                    id: fallbackId,
                    title: item.title,
                    date: new Date(item.published).toLocaleDateString('ko-KR'),
                    content: cleanText(item.description).substring(0, 200) + '...',
                    target: "모든 AWS 사용자",
                    features: "자세한 내용은 원문을 참조하세요",
                    regions: "해당 없음",
                    status: "정식 출시",
                    originalLink: item.link,
                    pubDate: item.published
                };
                
                processedItems.push(fallbackItem);
            }
        }

        console.log(`=== RSS 처리 완료: ${processedItems.length}개 아이템 ===`);
        
        // 날짜순 정렬 (최신순)
        processedItems.sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0));
        
        return processedItems;

    } catch (error) {
        console.error('RSS 피드 처리 중 오류:', error);
        throw error;
    }
}

// RSS XML 직접 가져오기
async function fetchRSSXML() {
    const https = await import('https');
    
    return new Promise((resolve, reject) => {
        https.default.get('https://aws.amazon.com/about-aws/whats-new/recent/feed/', (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                resolve(data);
            });
        }).on('error', (err) => {
            reject(err);
        });
    });
}

// XML에서 GUID 추출
function extractGUIDsFromXML(xmlData) {
    const guidMap = {};
    
    try {
        // 모든 <item> 태그 찾기
        const itemMatches = xmlData.match(/<item>(.*?)<\/item>/gs);
        
        if (itemMatches) {
            for (const itemXML of itemMatches) {
                // GUID 추출
                const guidMatch = itemXML.match(/<guid[^>]*>(.*?)<\/guid>/);
                // 링크 추출
                const linkMatch = itemXML.match(/<link>(.*?)<\/link>/);
                
                if (guidMatch && linkMatch) {
                    const guid = guidMatch[1].trim();
                    const link = linkMatch[1].trim();
                    guidMap[link] = guid;
                }
            }
        }
    } catch (error) {
        console.error('GUID 추출 중 오류:', error);
    }
    
    return guidMap;
}

// Nova Micro 번역 함수 (개선된 버전)
async function translateWithNovaMicro(title, content) {
    console.log('=== Nova Micro 번역 시작 ===');
    console.log('제목:', title.substring(0, 100) + '...');
    
    try {
        const cleanContent = cleanText(content);
        const shortContent = cleanContent.substring(0, 500); // 길이 증가
        
        // 개선된 프롬프트 사용
        const systemPrompt = generateSystemPrompt(title, shortContent);

        console.log('Nova Micro 호출 중...');

        const params = {
            modelId: 'apac.amazon.nova-micro-v1:0',
            contentType: 'application/json',
            accept: 'application/json',
            body: JSON.stringify({
                schemaVersion: "messages-v1",
                messages: [{ 
                    role: "user", 
                    content: [{ text: systemPrompt }] 
                }],
                inferenceConfig: {
                    maxTokens: 500, // 토큰 수 증가
                    temperature: 0.05, // 더 일관된 결과를 위해 낮춤
                    topP: 0.9
                }
            })
        };

        const command = new InvokeModelCommand(params);
        const response = await bedrockClient.send(command);
        
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        const aiResponse = responseBody.output?.message?.content?.[0]?.text || '';
        
        console.log('Nova Micro 응답 길이:', aiResponse.length);
        
        // JSON 응답 파싱
        if (aiResponse && aiResponse.trim().length > 20) {
            const translation = parseModelResponse(aiResponse);
            
            // 번역 품질 검증
            if (translation.title && translation.title.length > 5 && 
                translation.summary && translation.summary.length > 10) {
                console.log('번역 성공 - 제목:', translation.title.substring(0, 50) + '...');
                return translation;
            } else {
                console.log('번역 품질 부족, 기본값 사용');
                throw new Error('Translation quality insufficient');
            }
        } else {
            console.log('Nova Micro 응답이 너무 짧음, 기본값 사용');
            throw new Error('Response too short from Nova Micro');
        }

    } catch (error) {
        console.error('Nova Micro 번역 중 오류:', error.message);
        
        // 오류 시 향상된 기본값 반환
        return {
            title: translateTitleBasic(title),
            summary: generateKoreanSummary(title, cleanText(content).substring(0, 300)),
            target: determineTarget(title, content),
            features: extractFeatures(title, content),
            regions: determineRegions(content),
            status: determineStatus(content)
        };
    }
}

// 개선된 시스템 프롬프트 생성 함수
function generateSystemPrompt(title, description) {
    return `
AWS 서비스 업데이트를 분석하고 한국어 사용자를 위한 구조화된 요약을 제공하는 전문가입니다.

원문 제목: ${title}
원문 설명: ${description}

다음 JSON 형식으로 **한 줄**로 응답해주세요:

{"title": "한국어 제목", "summary": "3-4문장 요약", "target": "대상 사용자", "features": "주요 기능", "regions": "지원 리전", "status": "출시 상태"}

**중요한 지침:**
1. 응답은 반드시 **한 줄**로 작성하고 줄바꿈 없이 작성
2. JSON 형식을 정확히 준수
3. 각 필드는 다음과 같이 작성:
   - title: 명확하고 간결한 한국어 제목 (AWS 서비스명은 영문 유지)
   - summary: 주요 업데이트 내용을 3-4문장으로 요약 (200자 이내)
   - target: 주요 대상 사용자 그룹 (예: "개발자", "시스템 관리자", "모든 AWS 사용자")
   - features: 핵심 기능이나 변경사항 (100자 이내)
   - regions: 지원되는 AWS 리전 정보 (알 수 없으면 "선택된 리전")
   - status: "정식 출시", "미리보기", "베타" 중 하나

**예시:**
{"title": "AWS Lambda 새로운 메모리 옵션 지원", "summary": "AWS Lambda가 더 큰 메모리 옵션과 향상된 성능 모니터링을 제공합니다. 이를 통해 메모리 집약적인 워크로드의 성능이 개선됩니다.", "target": "서버리스 개발자", "features": "메모리 옵션 확장, 성능 모니터링", "regions": "모든 AWS 리전", "status": "정식 출시"}

지금 번역해주세요:
    `;
}

// Netlify에서 검증된 모델 응답 파싱 함수
function parseModelResponse(responseText) {
    try {
        const responseString = typeof responseText === 'string' ? responseText : JSON.stringify(responseText);
        
        // JSON 부분 추출
        const jsonStart = responseString.indexOf('{');
        const jsonEnd = responseString.lastIndexOf('}');
        
        if (jsonStart === -1 || jsonEnd === -1) {
            throw new Error('JSON 형식을 찾을 수 없습니다');
        }
        
        const jsonString = responseString.substring(jsonStart, jsonEnd + 1);
        
        // JSON 정리
        const cleanedJson = jsonString
            .replace(/\\n/g, ' ')
            .replace(/\\t/g, ' ')
            .replace(/\s{2,}/g, ' ')
            .replace(/\\\\"/g, '"')
            .replace(/\\'/g, "'")
            .trim();
        
        console.log('정리된 JSON:', cleanedJson);
        
        const parsedResponse = JSON.parse(cleanedJson);
        
        // content 필드가 문자열 형태의 JSON인 경우 파싱
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
        console.error('원본 응답:', responseText);
        
        // 파싱 실패 시 기본값 반환
        return {
            title: '파싱 오류 발생',
            summary: typeof responseText === 'string' ? responseText.substring(0, 200) : '응답 파싱 실패',
            target: "모든 AWS 사용자",
            features: "자세한 내용은 원문을 참조하세요",
            regions: "해당 없음",
            status: "정식 출시"
        };
    }
}

// 기본 제목 번역 함수
function translateTitleBasic(title) {
    // 간단한 키워드 기반 번역
    const translations = {
        'announces': '발표',
        'introduces': '도입',
        'launches': '출시',
        'releases': '릴리스',
        'supports': '지원',
        'adds': '추가',
        'updates': '업데이트',
        'improves': '개선',
        'enhances': '향상',
        'expands': '확장',
        'now available': '이제 사용 가능',
        'general availability': '정식 출시',
        'preview': '미리보기',
        'beta': '베타'
    };
    
    let translatedTitle = title;
    
    // 키워드 번역
    Object.keys(translations).forEach(eng => {
        const regex = new RegExp(eng, 'gi');
        translatedTitle = translatedTitle.replace(regex, translations[eng]);
    });
    
    // AWS 서비스명은 그대로 유지
    return translatedTitle;
}

// 한국어 요약 생성
function generateKoreanSummary(title, content) {
    const cleanContent = content.replace(/<[^>]*>/g, '').trim();
    
    if (title.toLowerCase().includes('announce')) {
        return `AWS에서 새로운 서비스 또는 기능을 발표했습니다. ${cleanContent.substring(0, 100)}...`;
    } else if (title.toLowerCase().includes('support')) {
        return `새로운 지원 기능이 추가되었습니다. ${cleanContent.substring(0, 100)}...`;
    } else if (title.toLowerCase().includes('launch')) {
        return `새로운 서비스가 출시되었습니다. ${cleanContent.substring(0, 100)}...`;
    } else {
        return `AWS 서비스 업데이트가 있었습니다. ${cleanContent.substring(0, 100)}...`;
    }
}

// 대상 사용자 결정
function determineTarget(title, content) {
    const lowerTitle = title.toLowerCase();
    const lowerContent = content.toLowerCase();
    
    if (lowerTitle.includes('developer') || lowerContent.includes('developer')) {
        return "개발자";
    } else if (lowerTitle.includes('admin') || lowerContent.includes('administrator')) {
        return "시스템 관리자";
    } else if (lowerTitle.includes('data') || lowerContent.includes('analytics')) {
        return "데이터 엔지니어";
    } else if (lowerTitle.includes('security') || lowerContent.includes('security')) {
        return "보안 담당자";
    } else {
        return "모든 AWS 사용자";
    }
}

// 핵심 기능 추출
function extractFeatures(title, content) {
    const lowerTitle = title.toLowerCase();
    
    if (lowerTitle.includes('api')) {
        return "새로운 API 기능";
    } else if (lowerTitle.includes('performance')) {
        return "성능 개선";
    } else if (lowerTitle.includes('security')) {
        return "보안 강화";
    } else if (lowerTitle.includes('cost')) {
        return "비용 최적화";
    } else if (lowerTitle.includes('integration')) {
        return "통합 기능 향상";
    } else {
        return "새로운 기능 및 개선사항";
    }
}

// 지원 리전 결정
function determineRegions(content) {
    const lowerContent = content.toLowerCase();
    
    if (lowerContent.includes('all regions') || lowerContent.includes('globally')) {
        return "모든 AWS 리전";
    } else if (lowerContent.includes('us-east') || lowerContent.includes('us-west')) {
        return "미국 리전";
    } else if (lowerContent.includes('eu-') || lowerContent.includes('europe')) {
        return "유럽 리전";
    } else if (lowerContent.includes('ap-') || lowerContent.includes('asia')) {
        return "아시아 태평양 리전";
    } else {
        return "선택된 리전";
    }
}

// 출시 상태 결정
function determineStatus(content) {
    const lowerContent = content.toLowerCase();
    
    if (lowerContent.includes('preview') || lowerContent.includes('beta')) {
        return "미리보기";
    } else if (lowerContent.includes('general availability') || lowerContent.includes('ga')) {
        return "정식 출시";
    } else {
        return "정식 출시";
    }
}

// 번역 응답 파싱 함수
function parseTranslationResponse(response, originalTitle, originalContent) {
    try {
        const lines = response.split('\n').map(line => line.trim()).filter(line => line);
        
        let title = originalTitle;
        let summary = originalContent.substring(0, 200);
        let target = "모든 AWS 사용자";
        let features = "새로운 기능 및 개선사항";
        let regions = "해당 없음";
        let status = "정식 출시";
        
        for (const line of lines) {
            if (line.startsWith('제목:')) {
                title = line.replace('제목:', '').trim();
            } else if (line.startsWith('요약:')) {
                summary = line.replace('요약:', '').trim();
            } else if (line.startsWith('대상:')) {
                target = line.replace('대상:', '').trim();
            } else if (line.startsWith('기능:')) {
                features = line.replace('기능:', '').trim();
            } else if (line.startsWith('지역:')) {
                regions = line.replace('지역:', '').trim();
            } else if (line.startsWith('상태:')) {
                status = line.replace('상태:', '').trim();
            }
        }
        
        // 상태 정규화
        if (status.includes('미리보기') || status.includes('preview')) {
            status = "미리보기";
        } else if (status.includes('베타') || status.includes('beta')) {
            status = "베타";
        } else {
            status = "정식 출시";
        }
        
        return { title, summary, target, features, regions, status };
        
    } catch (error) {
        console.error('번역 응답 파싱 오류:', error);
        return {
            title: originalTitle,
            summary: originalContent.substring(0, 200),
            target: "모든 AWS 사용자",
            features: "새로운 기능 및 개선사항",
            regions: "해당 없음",
            status: "정식 출시"
        };
    }
}

// 고유 ID 생성 함수 (더 안전한 방식)
function generateUniqueId(source) {
    if (!source) {
        return 'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
    
    // URL이나 GUID를 안전한 ID로 변환
    const hash = Buffer.from(source).toString('base64')
        .replace(/[^a-zA-Z0-9]/g, '')
        .substring(0, 50);
    
    return hash || ('item_' + Date.now());
}

// DynamoDB에서 아이템 조회 (단순화)
async function getItemFromDynamoDB(itemId) {
    try {
        console.log('DynamoDB에서 아이템 조회:', itemId);
        
        const command = new GetItemCommand({
            TableName: DYNAMODB_TABLE,
            Key: {
                id: { S: itemId }
            }
        });

        const result = await dynamoClient.send(command);
        
        if (result.Item) {
            console.log('기존 아이템 발견');
            return {
                id: result.Item.id.S,
                guid: result.Item.guid?.S || '',
                originalTitle: result.Item.originalTitle?.S || '',
                originalContent: result.Item.originalContent?.S || '',
                koTitle: result.Item.koTitle?.S || '',
                koSummary: result.Item.koSummary?.S || '',
                koTarget: result.Item.koTarget?.S || '',
                koFeatures: result.Item.koFeatures?.S || '',
                koRegions: result.Item.koRegions?.S || '',
                koStatus: result.Item.koStatus?.S || '',
                originalLink: result.Item.originalLink?.S || '',
                pubDate: result.Item.pubDate?.S || '',
                createdAt: result.Item.createdAt?.S || ''
            };
        }
        
        console.log('기존 아이템 없음');
        return null;
        
    } catch (error) {
        console.error('DynamoDB 조회 중 오류:', error);
        return null;
    }
}

// DynamoDB에 아이템 저장 (단순화)
async function saveItemToDynamoDB(item) {
    try {
        console.log('DynamoDB에 저장 시작:', item.id);
        
        const ttl = Math.floor((Date.now() + CACHE_DURATION) / 1000);
        
        const command = new PutItemCommand({
            TableName: DYNAMODB_TABLE,
            Item: {
                id: { S: item.id },
                guid: { S: item.guid || '' },
                originalTitle: { S: item.originalTitle || '' },
                originalContent: { S: item.originalContent || '' },
                koTitle: { S: item.koTitle || '' },
                koSummary: { S: item.koSummary || '' },
                koTarget: { S: item.koTarget || '' },
                koFeatures: { S: item.koFeatures || '' },
                koRegions: { S: item.koRegions || '' },
                koStatus: { S: item.koStatus || '' },
                originalLink: { S: item.originalLink || '' },
                pubDate: { S: item.pubDate || '' },
                createdAt: { S: item.createdAt || '' },
                ttl: { N: ttl.toString() },
                status: { S: 'active' }
            }
        });

        await dynamoClient.send(command);
        console.log('DynamoDB 저장 완료:', item.id);
        
    } catch (error) {
        console.error('DynamoDB 저장 중 오류:', error);
        throw error;
    }
}

// 캐시된 아이템 조회 (단순화)
async function getCachedItems() {
    try {
        console.log('캐시된 아이템 조회 시작');
        
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
        console.log(`DynamoDB에서 ${result.Items?.length || 0}개 아이템 발견`);
        
        if (result.Items && result.Items.length > 0) {
            const items = result.Items.map(item => formatItemForResponse({
                id: item.id.S,
                koTitle: item.koTitle?.S || item.originalTitle?.S || '',
                koSummary: item.koSummary?.S || '',
                koTarget: item.koTarget?.S || '',
                koFeatures: item.koFeatures?.S || '',
                koRegions: item.koRegions?.S || '',
                koStatus: item.koStatus?.S || '',
                originalLink: item.originalLink?.S || '',
                pubDate: item.pubDate?.S || ''
            }));

            // 날짜순 정렬
            return items.sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0));
        }
        
        return [];
        
    } catch (error) {
        console.error('캐시된 아이템 조회 중 오류:', error);
        return [];
    }
}

// 응답 형식으로 변환
function formatItemForResponse(item) {
    return {
        id: item.id,
        title: item.koTitle || item.originalTitle || '',
        date: item.pubDate ? new Date(item.pubDate).toLocaleDateString('ko-KR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        }) : '',
        content: item.koSummary || '',
        target: item.koTarget || "모든 AWS 사용자",
        features: item.koFeatures || "새로운 기능 및 개선사항",
        regions: item.koRegions || "해당 없음",
        status: item.koStatus || "정식 출시",
        originalLink: item.originalLink || '',
        pubDate: item.pubDate || ''
    };
}

// 텍스트 정리 함수
function cleanText(text) {
    if (!text) return '';
    
    return text
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();
}
