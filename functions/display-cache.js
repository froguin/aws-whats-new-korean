import { getStore } from "@netlify/blobs";

const CACHE_KEY = 'aws-updates-v2';

// 캐시된 데이터 표시 핸들러
export const handler = async () => {
  const store = getStore({
    name: "aws-updates-store",
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_ACCESS_TOKEN
  });

  try {
    const cachedData = await store.get(CACHE_KEY);
    if (cachedData) {
      // 캐시된 데이터를 바로 출력
      return {
        statusCode: 200,
        body: JSON.stringify(JSON.parse(cachedData)),
      };
    } else {
      return {
        statusCode: 404,
        body: JSON.stringify({ message: '캐시된 데이터가 없습니다.' }),
      };
    }
  } catch (error) {
    console.error('캐시된 데이터 가져오는 중 오류 발생:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: '서버 오류 발생' }),
    };
  }
}; 