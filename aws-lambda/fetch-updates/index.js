import { DynamoDBClient, GetItemCommand, PutItemCommand, ScanCommand } from "@aws-sdk/client-dynamodb";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'ap-northeast-2' });
const bedrockClient = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'ap-northeast-2' });

const TABLE_NAME = process.env.DYNAMODB_TABLE || 'aws-updates-cache-prod';

export const handler = async (event) => {
    console.log('=== AWS What\'s New 한국어 요약 Lambda 시작 ===');
    console.log('Event:', JSON.stringify(event, null, 2));
    
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    };

    try {
        // OPTIONS 요청 처리
        if (event.httpMethod === 'OPTIONS') {
            return { statusCode: 200, headers, body: '' };
        }

        // 강제 새로고침 여부 확인
        const forceRefresh = event.queryStringParameters?.refresh === 'true';
        console.log('강제 새로고침:', forceRefresh);

        let items = [];
        let isCached = true;

        if (forceRefresh) {
            console.log('강제 새로고침 - RSS 피드에서 새 데이터 가져오기');
            items = await fetchAndProcessRSSFeed();
            isCached = false;
        } else {
            // 캐시된 데이터 확인
            console.log('캐시된 데이터 확인 중...');
            const cachedItems = await getCachedItems();
            
            if (cachedItems && cachedItems.length > 0) {
                console.log(`캐시된 아이템 ${cachedItems.length}개 발견`);
                items = cachedItems;
                isCached = true;
            } else {
                console.log('캐시된 데이터 없음 - RSS 피드에서 새 데이터 가져오기');
                items = await fetchAndProcessRSSFeed();
                isCached = false;
            }
        }

        // 응답 생성
        const response = {
            items: items.slice(0, 100), // 최대 100개 반환
            meta: {
                isCached,
                lastUpdated: new Date().toISOString(),
                itemCount: items.length
            }
        };

        console.log(`총 ${items.length}개 아이템 반환 (캐시됨: ${isCached})`);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(response)
        };

    } catch (error) {
        console.error('Lambda 실행 중 오류:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Internal Server Error',
                message: error.message
            })
        };
    }
};

// RSS 피드 가져오기 및 처리
async function fetchAndProcessRSSFeed() {
    console.log('=== RSS 피드 처리 시작 ===');
    
    try {
        // RSS XML 직접 가져오기
        const rssXml = await fetchRSSXML();
        console.log('RSS XML 가져오기 완료, 길이:', rssXml.length);
        
        // XML 파싱
        const rssData = parseRSSXML(rssXml);
        console.log('RSS 파싱 완료, 아이템 수:', rssData.items.length);
        
        const processedItems = [];
        const maxItems = 100; // 100개 전체 처리

        // 모든 RSS 아이템 처리
        const itemsToProcess = rssData.items.slice(0, maxItems);
        console.log(`처리할 아이템 수: ${itemsToProcess.length}개`);

        for (let i = 0; i < itemsToProcess.length; i++) {
            const item = itemsToProcess[i];
            
            try {
                console.log(`\n=== 아이템 ${i + 1}/${itemsToProcess.length} 처리 중 ===`);
                console.log('제목:', item.title?.substring(0, 80) + '...');
                
                // 고유 ID 생성 (GUID 기반)
                const itemId = generateItemId(item.guid || item.link);
                console.log('생성된 ID:', itemId);
                
                // 기존 아이템 확인
                const existingItem = await getItemFromDynamoDB(itemId);
                if (existingItem) {
                    console.log('이미 존재하는 아이템, 건너뛰기');
                    processedItems.push(existingItem);
                    continue;
                }
                
                // Nova Micro로 전체 번역 및 분석
                const translation = await translateWithNovaMicro(item.title, item.description);
                console.log('번역 완료 - 제목:', translation.title?.substring(0, 50) + '...');
                
                // 처리된 아이템 생성
                const processedItem = {
                    id: itemId,
                    title: translation.title,
                    date: formatDate(item.pubDate),
                    content: translation.summary,
                    target: translation.target,
                    features: translation.features,
                    regions: translation.regions,
                    status: translation.status,
                    originalLink: item.link,
                    pubDate: item.pubDate
                };
                
                // DynamoDB에 저장
                await saveItemToDynamoDB(processedItem);
                processedItems.push(processedItem);
                
                console.log(`아이템 ${i + 1} 처리 완료`);
                
                // API 제한을 위한 지연 (3개마다 3초 대기)
                if ((i + 1) % 3 === 0 && i < itemsToProcess.length - 1) {
                    console.log('API 제한을 위해 3초 대기...');
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }
                
            } catch (itemError) {
                console.error(`아이템 ${i + 1} 처리 중 오류:`, itemError.message);
                // 오류가 발생해도 계속 진행
                continue;
            }
        }
        
        console.log(`=== RSS 피드 처리 완료: ${processedItems.length}개 아이템 ===`);
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

// RSS XML 파싱
function parseRSSXML(xmlString) {
    const items = [];
    
    try {
        // <item> 태그들을 찾아서 파싱
        const itemMatches = xmlString.match(/<item[^>]*>[\s\S]*?<\/item>/g);
        
        if (itemMatches) {
            console.log(`발견된 아이템 수: ${itemMatches.length}`);
            
            for (const itemXml of itemMatches) {
                try {
                    const item = {};
                    
                    // 제목 추출 (CDATA 처리)
                    const titleMatch = itemXml.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/s);
                    item.title = titleMatch ? titleMatch[1].trim() : '';
                    
                    // 설명 추출 (CDATA 처리)
                    const descMatch = itemXml.match(/<description>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/description>/s);
                    item.description = descMatch ? descMatch[1].trim() : '';
                    
                    // 링크 추출
                    const linkMatch = itemXml.match(/<link>(.*?)<\/link>/);
                    item.link = linkMatch ? linkMatch[1].trim() : '';
                    
                    // GUID 추출
                    const guidMatch = itemXml.match(/<guid[^>]*>(.*?)<\/guid>/);
                    item.guid = guidMatch ? guidMatch[1].trim() : '';
                    
                    // 발행일 추출
                    const pubDateMatch = itemXml.match(/<pubDate>(.*?)<\/pubDate>/);
                    item.pubDate = pubDateMatch ? pubDateMatch[1].trim() : '';
                    
                    if (item.title && item.description) {
                        items.push(item);
                    }
                } catch (parseError) {
                    console.error('아이템 파싱 오류:', parseError.message);
                    continue;
                }
            }
        } else {
            console.log('RSS XML에서 <item> 태그를 찾을 수 없습니다');
        }
    } catch (error) {
        console.error('RSS XML 파싱 전체 오류:', error.message);
    }
    
    console.log(`파싱 완료: ${items.length}개 아이템 추출`);
    return { items };
}

// Nova Micro 통합 번역 함수 (개선된 버전)
async function translateWithNovaMicro(title, content) {
    console.log('=== Nova Micro 통합 번역 시작 ===');
    
    try {
        const cleanContent = cleanText(content);
        const shortContent = cleanContent.substring(0, 800); // 더 많은 컨텍스트 제공
        
        // 고품질 한국어 번역 프롬프트 - 기존 Netlify 버전 품질 복원
        const prompt = `
당신은 AWS 전문 기술 번역가입니다. 다음 AWS 업데이트를 완벽한 한국어로 번역하고 요약해주세요.

원문:
제목: ${title}
내용: ${shortContent}

번역 규칙:
1. 제목을 자연스러운 한국어로 완전 번역 (AWS 서비스명만 영어 유지)
2. 내용을 한국 개발자가 바로 이해할 수 있는 한국어로 요약
3. 기술적 세부사항과 실제 활용 방안 포함
4. "업데이트가 있었습니다" 같은 불필요한 문구 절대 사용 금지
5. 구체적이고 실용적인 정보만 제공

JSON 응답:
{
  "title": "완전한 한국어 제목 (서비스명만 영어)",
  "summary": "핵심 기능과 장점을 구체적으로 설명한 한국어 요약 (2-3문장)",
  "target": "개발자|시스템관리자|데이터엔지니어|보안담당자|모든사용자",
  "features": "새기능|성능개선|보안강화|비용최적화|API개선",
  "regions": "전체리전|미국리전|유럽리전|아시아태평양|선택리전|해당없음",
  "status": "정식출시|미리보기|베타"
}

JSON만 응답하세요.`;

        console.log('Nova Micro 호출 중...');

        const params = {
            modelId: 'apac.amazon.nova-micro-v1:0',
            contentType: 'application/json',
            accept: 'application/json',
            body: JSON.stringify({
                schemaVersion: "messages-v1",
                messages: [{ 
                    role: "user", 
                    content: [{ text: prompt }] 
                }],
                inferenceConfig: {
                    maxTokens: 800,
                    temperature: 0.1, // 일관성을 위해 낮게 설정
                    topP: 0.9
                }
            })
        };

        const command = new InvokeModelCommand(params);
        const response = await bedrockClient.send(command);
        
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        const aiResponse = responseBody.output?.message?.content?.[0]?.text || '';
        
        console.log('Nova Micro 응답 길이:', aiResponse.length);
        console.log('Nova Micro 응답 미리보기:', aiResponse.substring(0, 200) + '...');
        
        // JSON 응답 파싱
        if (aiResponse && aiResponse.trim().length > 50) {
            const translation = parseAIResponse(aiResponse);
            
            // 번역 품질 검증
            if (translation.title && translation.title.length > 5 && 
                translation.summary && translation.summary.length > 20) {
                console.log('번역 성공 - 제목:', translation.title.substring(0, 50) + '...');
                return translation;
            } else {
                console.log('번역 품질 부족, fallback 사용');
                throw new Error('Translation quality insufficient');
            }
        } else {
            console.log('Nova Micro 응답이 너무 짧음, fallback 사용');
            throw new Error('Response too short from Nova Micro');
        }

    } catch (error) {
        console.error('Nova Micro 번역 중 오류:', error.message);
        
        // 오류 시 기본값 반환 (의미없는 문구 제거)
        return {
            title: title.replace(/^AWS /, '').replace(/announces?/i, '발표').replace(/launches?/i, '출시').replace(/introduces?/i, '도입'),
            summary: `${cleanText(content).substring(0, 200).replace(/AWS/g, '').trim()}에 대한 새로운 기능이 추가되었습니다.`,
            target: '개발자',
            features: '새기능',
            regions: '선택리전',
            status: '정식출시'
        };
    }
}

// AI 응답 파싱 (개선된 버전)
function parseAIResponse(response) {
    try {
        // JSON 블록 찾기
        let jsonStr = response.trim();
        
        // ```json 블록 제거
        if (jsonStr.includes('```json')) {
            const jsonMatch = jsonStr.match(/```json\s*([\s\S]*?)\s*```/);
            if (jsonMatch) {
                jsonStr = jsonMatch[1];
            }
        } else if (jsonStr.includes('```')) {
            const jsonMatch = jsonStr.match(/```\s*([\s\S]*?)\s*```/);
            if (jsonMatch) {
                jsonStr = jsonMatch[1];
            }
        }
        
        // JSON 파싱 시도
        const parsed = JSON.parse(jsonStr);
        
        // 필수 필드 검증 및 기본값 설정
        return {
            title: parsed.title || '제목 없음',
            summary: parsed.summary || '요약 없음',
            target: parsed.target || '모든 AWS 사용자',
            features: parsed.features || '새로운 기능 및 개선사항',
            regions: parsed.regions || '선택된 리전',
            status: parsed.status || '정식 출시'
        };
        
    } catch (parseError) {
        console.error('AI 응답 파싱 오류:', parseError.message);
        console.log('파싱 실패한 응답:', response.substring(0, 200) + '...');
        
        // 파싱 실패 시 기본값 반환
        return {
            title: '제목 파싱 실패',
            summary: '요약 파싱 실패',
            target: '모든 AWS 사용자',
            features: '새로운 기능 및 개선사항',
            regions: '선택된 리전',
            status: '정식 출시'
        };
    }
}

// 텍스트 정리 함수
function cleanText(text) {
    if (!text) return '';
    
    return text
        .replace(/<[^>]*>/g, '') // HTML 태그 제거
        .replace(/&[^;]+;/g, ' ') // HTML 엔티티 제거
        .replace(/\s+/g, ' ') // 연속된 공백을 하나로
        .replace(/\n+/g, ' ') // 개행 문자 제거
        .trim();
}

// 고유 ID 생성
function generateItemId(guid) {
    if (guid) {
        // GUID를 base64로 인코딩하여 고유 ID 생성
        return Buffer.from(guid).toString('base64').replace(/[+/=]/g, '').substring(0, 50);
    }
    // fallback: 타임스탬프 + 랜덤
    return 'item_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
}

// 날짜 포맷팅
function formatDate(dateString) {
    try {
        const date = new Date(dateString);
        return date.toLocaleDateString('ko-KR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    } catch (error) {
        return dateString || '날짜 없음';
    }
}

// DynamoDB 관련 함수들
async function getCachedItems() {
    try {
        const params = {
            TableName: TABLE_NAME,
            Limit: 100
        };
        
        const command = new ScanCommand(params);
        const result = await dynamoClient.send(command);
        
        if (result.Items && result.Items.length > 0) {
            return result.Items.map(item => ({
                id: item.id?.S || '',
                title: item.title?.S || '',
                date: item.date?.S || '',
                content: item.content?.S || '',
                target: item.target?.S || '',
                features: item.features?.S || '',
                regions: item.regions?.S || '',
                status: item.status?.S || '',
                originalLink: item.originalLink?.S || '',
                pubDate: item.pubDate?.S || ''
            }));
        }
        
        return [];
    } catch (error) {
        console.error('캐시된 아이템 가져오기 오류:', error);
        return [];
    }
}

async function getItemFromDynamoDB(itemId) {
    try {
        const params = {
            TableName: TABLE_NAME,
            Key: {
                id: { S: itemId }
            }
        };
        
        const command = new GetItemCommand(params);
        const result = await dynamoClient.send(command);
        
        if (result.Item) {
            return {
                id: result.Item.id?.S || '',
                title: result.Item.title?.S || '',
                date: result.Item.date?.S || '',
                content: result.Item.content?.S || '',
                target: result.Item.target?.S || '',
                features: result.Item.features?.S || '',
                regions: result.Item.regions?.S || '',
                status: result.Item.status?.S || '',
                originalLink: result.Item.originalLink?.S || '',
                pubDate: result.Item.pubDate?.S || ''
            };
        }
        
        return null;
    } catch (error) {
        console.error('DynamoDB 아이템 가져오기 오류:', error);
        return null;
    }
}

async function saveItemToDynamoDB(item) {
    try {
        // TTL 설정 (30일 후 자동 삭제)
        const ttl = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60);
        
        const params = {
            TableName: TABLE_NAME,
            Item: {
                id: { S: item.id },
                title: { S: item.title },
                date: { S: item.date },
                content: { S: item.content },
                target: { S: item.target },
                features: { S: item.features },
                regions: { S: item.regions },
                status: { S: item.status },
                originalLink: { S: item.originalLink },
                pubDate: { S: item.pubDate },
                ttl: { N: ttl.toString() },
                createdAt: { S: new Date().toISOString() }
            }
        };
        
        const command = new PutItemCommand(params);
        await dynamoClient.send(command);
        
        console.log('DynamoDB 저장 완료:', item.id);
    } catch (error) {
        console.error('DynamoDB 저장 오류:', error);
        throw error;
    }
}
