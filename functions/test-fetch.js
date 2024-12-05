import { parse } from 'rss-to-json';
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { getStore } from "@netlify/blobs";
import { parseStringPromise } from 'xml2js';
import fetch from 'node-fetch';

const RSS_URL = 'https://aws.amazon.com/about-aws/whats-new/recent/feed/';
const CACHE_KEY = 'aws-updates-v2';
const CACHE_TTL_DAY = 7; // 7일간 정보 유지
const MAX_ITEMS_TO_PROCESS = 3; // 최대 처리할 항목 수

// AWS Bedrock 클라이언트 초기화
const bedrockClient = new BedrockRuntimeClient({
  region: process.env.CUSTOM_AWS_REGION,
  credentials: {
    accessKeyId: process.env.CUSTOM_AWS_ACCESS_KEY,
    secretAccessKey: process.env.CUSTOM_AWS_SECRET_KEY
  }
});

// RSS 피드 가져오기 함수
async function fetchRss() {
  try {
    const response = await fetch(RSS_URL);
    const text = await response.text();
    const result = await parseStringPromise(text);
    
    // RSS 피드에서 item 배열을 반환
    return result.rss.channel[0].item;
  } catch (error) {
    console.error('RSS 피드 가져오기 오류:', error);
    throw error;
  }
}

// 새로운 아이템 처리 함수
async function processItem(item) {
  const itemGuid = item.guid[0]; // guid를 배열에서 가져옴
  console.log('아이템 GUID:', itemGuid);
  const itemPubDate = new Date(item.pubDate[0]).toISOString(); // pubDate를 사용하여 ISO 형식으로 변환

  try {
    console.log('처리 시작:', item.title[0].substring(0, 30) + '...');
    const summaryResponse = await invokeNovaLiteSummarization(item.title[0], item.description[0]);
    console.log('처리 완료:', item.title[0].substring(0, 30) + '...');

    const newItem = {
      title: summaryResponse.title,
      date: new Date(item.pubDate[0]).toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }),
      content: summaryResponse.summary,
      target: summaryResponse.target || "모든 AWS 사용자",
      features: summaryResponse.features || "자세한 내용은 원문을 참조하세요",
      regions: summaryResponse.regions || "지원 리전 정보 없음",
      status: summaryResponse.status || "일반 공개",
      originalLink: item.link[0] || '',
      guid: itemGuid,
      pubDate: itemPubDate
    };

    return newItem;
  } catch (error) {
    console.error(`아이템 처리 중 오류 (GUID: ${itemGuid}):`, error);
    return null;
  }
}

// RSS 아이템 처리 함수
async function processRssItems() {
  const rssItems = await fetchRss();
  console.log('전체 RSS 항목 수:', rssItems.length);

  for (const item of rssItems) {
    await processItem(item); // 각 아이템 처리
  }
}

// 핸들러 함수
export const handler = async () => {
  try {
    console.log('=== Function started ===');
    
    // RSS 아이템 처리
    await processRssItems();

    console.log('=== Function completed ===');
  } catch (error) {
    console.error('Error in handler:', error);
  }
};
