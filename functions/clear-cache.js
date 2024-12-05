import { getStore } from "@netlify/blobs";

export const handler = async () => {
  try {
    const store = getStore({
      name: "aws-updates-store",
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_ACCESS_TOKEN
    });

    await store.delete('aws-updates-v2');
    await store.delete('aws-updates-undefined');
  
    return {
      statusCode: 200,
      body: JSON.stringify({ message: '캐시가 성공적으로 초기화되었습니다.' })
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: '캐시 초기화 실패', details: error.message })
    };
  }
}; 