const fs = require('fs');

// 기존 파일 읽기
let content = fs.readFileSync('index.js', 'utf8');

// Nova Micro 번역 함수 교체
const oldFunction = /\/\/ Nova Micro 번역 함수.*?^}/ms;
const newFunction = `// Nova Micro 번역 함수 (Netlify 검증된 프롬프트 사용)
async function translateWithNovaMicro(title, content) {
    console.log('=== Nova Micro 번역 시작 ===');
    console.log('제목:', title);
    
    try {
        const cleanContent = cleanText(content);
        const shortContent = cleanContent.substring(0, 400);
        
        // Netlify에서 검증된 프롬프트 사용
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
                    maxTokens: 400,
                    temperature: 0.1,
                    topP: 0.8
                }
            })
        };

        const command = new InvokeModelCommand(params);
        const response = await bedrockClient.send(command);
        
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        const aiResponse = responseBody.output?.message?.content?.[0]?.text || '';
        
        console.log('Nova Micro 원본 응답:', aiResponse);
        
        if (aiResponse && aiResponse.trim().length > 10) {
            const translation = parseModelResponse(aiResponse);
            console.log('파싱된 번역:', translation);
            return translation;
        } else {
            throw new Error('Empty response from Nova Micro');
        }

    } catch (error) {
        console.error('Nova Micro 번역 중 오류:', error);
        
        return {
            title: translateTitleBasic(title),
            summary: generateKoreanSummary(title, cleanText(content).substring(0, 200)),
            target: determineTarget(title, content),
            features: extractFeatures(title, content),
            regions: determineRegions(content),
            status: determineStatus(content)
        };
    }
}`;

// 함수 교체
content = content.replace(oldFunction, newFunction);

// 새로운 함수들 추가
const additionalFunctions = `

// Netlify에서 검증된 시스템 프롬프트 생성 함수
function generateSystemPrompt(title, description) {
    return \`
You are an expert in analyzing AWS service updates and providing concise, structured summaries for Korean-speaking AWS users.

Original Title: \${title}
Original Description: \${description}

Please provide a **single-line JSON-formatted response** with the following structure:
{
  "title": "한국어로 번역된 명확하고 간결한 제목",
  "summary": "3-4문장으로 주요 업데이트 내용을 한국어로 요약 (250자 이하)",
  "target": "이 업데이트의 주요 대상 사용자 그룹 (단일 문장)",
  "features": "주요 기능 또는 변경 사항 요약 (100자 이하)",
  "regions": "지원되는 AWS 리전 (알려진 경우, 없으면 '해당 없음')",
  "status": "현재 상태 (예: 정식 출시, 미리보기 등)"
}

**Important Guidelines:**
1. 응답은 **단일 줄**로 작성하고 줄바꿈이나 탭 문자를 사용하지 마십시오.
2. 각 필드 값은 평문 문자열로 작성하고 중첩된 JSON을 포함하지 마십시오.
3. 모든 필드는 JSON.parse()로 바로 파싱 가능해야 합니다.
4. 번역 시에 AWS 또는 Amazon 으로 시작하는 제품명은 원문 그대로 표현하는 것이 좋습니다.
    \`;
}

// Netlify에서 검증된 모델 응답 파싱 함수
function parseModelResponse(responseText) {
    try {
        const responseString = typeof responseText === 'string' ? responseText : JSON.stringify(responseText);
        
        const jsonStart = responseString.indexOf('{');
        const jsonEnd = responseString.lastIndexOf('}');
        
        if (jsonStart === -1 || jsonEnd === -1) {
            throw new Error('JSON 형식을 찾을 수 없습니다');
        }
        
        const jsonString = responseString.substring(jsonStart, jsonEnd + 1);
        const cleanedJson = jsonString
            .replace(/\\\\n/g, ' ')
            .replace(/\\\\t/g, ' ')
            .replace(/\\s{2,}/g, ' ')
            .trim();
        
        console.log('정리된 JSON:', cleanedJson);
        const parsedResponse = JSON.parse(cleanedJson);
        
        return {
            title: parsedResponse.title || '제목 없음',
            summary: parsedResponse.summary || '내용 없음',
            target: parsedResponse.target || "모든 AWS 사용자",
            features: parsedResponse.features || "자세한 내용은 원문을 참조하세요",
            regions: parsedResponse.regions || "지원 리전 정보 없음",
            status: parsedResponse.status || "정식 출시"
        };
        
    } catch (error) {
        console.error('JSON 파싱 오류:', error);
        
        return {
            title: '파싱 오류 발생',
            summary: typeof responseText === 'string' ? responseText.substring(0, 200) : '응답 파싱 실패',
            target: "모든 AWS 사용자",
            features: "자세한 내용은 원문을 참조하세요",
            regions: "해당 없음",
            status: "정식 출시"
        };
    }
}`;

// 파일 끝에 새 함수들 추가
content = content + additionalFunctions;

// 파일 저장
fs.writeFileSync('index.js', content);
console.log('번역 함수 업데이트 완료');
