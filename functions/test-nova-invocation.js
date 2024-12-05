import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

// 클라이언트를 최상위 범위에서 생성
const bedrockClient = new BedrockRuntimeClient({
  region: process.env.CUSTOM_AWS_REGION,
  credentials: {
    accessKeyId: process.env.CUSTOM_AWS_ACCESS_KEY,
    secretAccessKey: process.env.CUSTOM_AWS_SECRET_KEY
  }
});

// 샘플 XML RSS 본문
const sampleXmlRssBody = `
<rss version="2.0">
  <channel>
    <title>Sample RSS Feed</title>
    <description>This is a sample RSS feed for testing.</description>
    <item>
      <title>Sample Item 1</title>
      <description>This is a description for sample item 1.</description>
      <link>http://example.com/sample-item-1</link>
      <pubDate>Mon, 04 Dec 2023 12:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>
`;

// 시스템 프롬프트 생성 함수
function generateSystemPrompt(xmlBody) {
  return `
You are an expert in analyzing RSS feeds and providing concise summaries.

Original XML RSS Body: ${xmlBody}

Please provide a **single-line JSON-formatted response** with the following structure:
{
  "summary": "주요 내용을 요약한 한국어 문장"
}
`;
}

// Nova 모델을 사용한 요약 및 번역 함수
async function invokeNovaLiteSummarization(xmlBody) {
  const prompt = generateSystemPrompt(xmlBody);
  const params = {
    modelId: 'us.amazon.nova-lite-v1:0',
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      schemaVersion: "messages-v1",
      messages: [
        {
          role: "user",
          content: [{ text: prompt }]
        }
      ],
      inferenceConfig: {
        max_new_tokens: 1000,
        top_p: 0.9,
        top_k: 20,
        temperature: 0.7
      }
    })
  };

  try {
    const command = new InvokeModelCommand(params);
    const response = await bedrockClient.send(command);
    const decodedResponseBody = new TextDecoder().decode(response.body);
    const parsedResponse = JSON.parse(decodedResponseBody);
    return parsedResponse; // JSON 형식으로 반환
  } catch (error) {
    console.error('NovaLite 모델 호출 중 오류:', error);
    throw error;
  }
}

// 테스트 함수
export const handler = async () => {
  try {
    const result = await invokeNovaLiteSummarization(sampleXmlRssBody);
    console.log('NovaLite 모델 응답:', result);
    return {
      statusCode: 200,
      body: JSON.stringify(result),
    };
  } catch (error) {
    console.error('테스트 함수 오류:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: '서버 오류가 발생했습니다', details: error.message }),
    };
  }
}; 