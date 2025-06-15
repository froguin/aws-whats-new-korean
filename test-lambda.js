// Lambda 함수 테스트 스크립트
import rssToJson from 'rss-to-json';

const { parse } = rssToJson;

async function testRSSParsing() {
    console.log('=== RSS 피드 테스트 시작 ===');
    
    try {
        // RSS 피드 파싱
        const rssData = await parse('https://aws.amazon.com/about-aws/whats-new/recent/feed/');
        
        console.log(`RSS에서 ${rssData.items.length}개 아이템 발견`);
        
        // 처음 3개 아이템 확인
        for (let i = 0; i < Math.min(3, rssData.items.length); i++) {
            const item = rssData.items[i];
            console.log(`\n--- 아이템 ${i + 1} ---`);
            console.log('제목:', item.title);
            console.log('링크:', item.link);
            console.log('발행일:', item.published);
            console.log('설명 길이:', item.description?.length || 0);
            
            // GUID 확인
            if (item.guid) {
                console.log('GUID:', item.guid);
            } else {
                console.log('GUID: 없음');
            }
        }
        
    } catch (error) {
        console.error('RSS 파싱 오류:', error);
    }
}

// XML에서 GUID 추출 테스트
async function testGUIDExtraction() {
    console.log('\n=== GUID 추출 테스트 ===');
    
    try {
        const https = await import('https');
        
        const xmlData = await new Promise((resolve, reject) => {
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
        
        // GUID 추출
        const guidMap = {};
        const itemMatches = xmlData.match(/<item>(.*?)<\/item>/gs);
        
        if (itemMatches) {
            console.log(`XML에서 ${itemMatches.length}개 아이템 발견`);
            
            for (let i = 0; i < Math.min(3, itemMatches.length); i++) {
                const itemXML = itemMatches[i];
                
                // GUID 추출
                const guidMatch = itemXML.match(/<guid[^>]*>(.*?)<\/guid>/);
                // 링크 추출
                const linkMatch = itemXML.match(/<link>(.*?)<\/link>/);
                
                if (guidMatch && linkMatch) {
                    const guid = guidMatch[1].trim();
                    const link = linkMatch[1].trim();
                    guidMap[link] = guid;
                    
                    console.log(`\n아이템 ${i + 1}:`);
                    console.log('GUID:', guid);
                    console.log('링크:', link);
                }
            }
        }
        
        console.log(`\n총 ${Object.keys(guidMap).length}개 GUID 매핑 생성`);
        
    } catch (error) {
        console.error('GUID 추출 오류:', error);
    }
}

// 고유 ID 생성 테스트
function testUniqueIdGeneration() {
    console.log('\n=== 고유 ID 생성 테스트 ===');
    
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
    
    // 테스트 케이스들
    const testCases = [
        '194e69d19a00f575666dd03acc0f7f0ad525d5f1',
        'https://aws.amazon.com/about-aws/whats-new/2025/06/open-source-aws-api-models',
        '',
        null
    ];
    
    testCases.forEach((testCase, index) => {
        const id = generateUniqueId(testCase);
        console.log(`테스트 ${index + 1}: "${testCase}" -> "${id}"`);
    });
}

// 모든 테스트 실행
async function runAllTests() {
    await testRSSParsing();
    await testGUIDExtraction();
    testUniqueIdGeneration();
}

runAllTests().catch(console.error);
