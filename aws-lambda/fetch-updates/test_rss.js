const rssToJson = require('rss-to-json');

async function testRSSParsing() {
    try {
        console.log('RSS 피드 파싱 테스트 시작...');
        
        const rssData = await rssToJson.parse('https://aws.amazon.com/about-aws/whats-new/recent/feed/');
        
        console.log(`총 ${rssData.items.length}개 아이템 발견`);
        
        // 첫 3개 아이템의 GUID와 기본 정보 확인
        for (let i = 0; i < Math.min(3, rssData.items.length); i++) {
            const item = rssData.items[i];
            console.log(`\n=== 아이템 ${i + 1} ===`);
            console.log('제목:', item.title);
            console.log('GUID:', item.guid);
            console.log('링크:', item.link);
            console.log('발행일:', item.published);
            console.log('설명 길이:', item.description ? item.description.length : 0);
            
            // 모든 속성 확인
            console.log('모든 속성:', Object.keys(item));
            
            // GUID 기반 ID 생성 테스트
            const uniqueSource = item.guid || item.link || item.title;
            const itemId = Buffer.from(uniqueSource).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 50);
            console.log('생성된 ID:', itemId);
        }
        
    } catch (error) {
        console.error('RSS 파싱 오류:', error);
    }
}

testRSSParsing();
