const https = require('https');

function fetchRSSFeed() {
    return new Promise((resolve, reject) => {
        https.get('https://aws.amazon.com/about-aws/whats-new/recent/feed/', (res) => {
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

async function testXMLParsing() {
    try {
        console.log('RSS XML 직접 파싱 테스트 시작...');
        
        const xmlData = await fetchRSSFeed();
        
        // 첫 번째 아이템의 GUID 추출
        const itemMatch = xmlData.match(/<item>(.*?)<\/item>/s);
        if (itemMatch) {
            const itemXML = itemMatch[1];
            console.log('\n첫 번째 아이템 XML:');
            console.log(itemXML.substring(0, 500) + '...');
            
            // GUID 추출
            const guidMatch = itemXML.match(/<guid[^>]*>(.*?)<\/guid>/);
            if (guidMatch) {
                console.log('\nGUID 발견:', guidMatch[1]);
            } else {
                console.log('\nGUID를 찾을 수 없습니다.');
            }
            
            // 제목 추출
            const titleMatch = itemXML.match(/<title>(.*?)<\/title>/);
            if (titleMatch) {
                console.log('제목:', titleMatch[1]);
            }
            
            // 링크 추출
            const linkMatch = itemXML.match(/<link>(.*?)<\/link>/);
            if (linkMatch) {
                console.log('링크:', linkMatch[1]);
            }
        }
        
    } catch (error) {
        console.error('XML 파싱 오류:', error);
    }
}

testXMLParsing();
