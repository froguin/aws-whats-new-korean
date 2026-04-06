# AWS What's New 한국어 요약

AWS 공식 릴리스 노트를 한국어로 자동 번역·검수하여 보여주는 서버리스 애플리케이션입니다.

## 아키텍처

```
EventBridge (15분 크론)
  → Lambda: RSS 수집 → DynamoDB 저장 → SQS 큐잉

SQS → Lambda:
  → Bedrock Nova Micro: 번역
  → 품질 게이트: CJK 오염, 마크다운 잔재 등 자동 감지
  → Bedrock Nova Lite: AI 검수
  → DynamoDB 저장

Amplify (Astro SSR)
  → /              Cloudscape 테마 대시보드
  → /api/articles  기사 조회 API
  → /api/stats     파이프라인 상태 API
```

## 번역 파이프라인

1. **번역**: Nova Micro — 본문 요약 → 제목 도출 → 상태/대상/기능/리전 추출
2. **품질 게이트**: CJK 오염, 마크다운 잔재, 제목 잘림 등 자동 감지 → 재시도
3. **AI 검수**: Nova Lite — 제목/상태/리전 등 필드별 교차 검증, 오류 시 수정

## 비용

| 서비스 | 프리티어 | 예상 사용량 |
|--------|---------|------------|
| Lambda | 1M req/월 | ~3K/월 |
| DynamoDB | 25GB, 25 RCU/WCU | ~50MB |
| SQS | 1M msg/월 | ~3K/월 |
| EventBridge | 무료 | 크론 1개 |
| Amplify Hosting | 빌드 1000분/월 | ~10분/배포 |
| Bedrock (Nova Micro+Lite) | 종량제 | **~$0.50/월** |

## 사전 요구사항

- AWS CLI + SAM CLI 설치
- Node.js 20+
- Bedrock 모델 접근 활성화 (Nova Micro, Nova Lite)

## 배포

```bash
# 1. 백엔드 (DynamoDB, SQS, Lambda)
sam build
sam deploy --guided --region ap-northeast-2

# 2. (선택) Netlify 기존 데이터 마이그레이션 — 일회성
TABLE_NAME=aws-whats-new-prod \
NETLIFY_SITE_ID=your-site-id \
NETLIFY_ACCESS_TOKEN=your-token \
  node scripts/migrate-from-netlify.js

# 3. 프론트엔드 (Amplify)
# Amplify Console에서 GitHub 레포 연결 → 자동 배포
```

## 로컬 개발

```bash
npm install
npm run dev          # Astro 개발 서버
sam local invoke     # Lambda 로컬 테스트
```

## 프로젝트 구조

```
├── template.yaml              # SAM 템플릿
├── functions/
│   ├── rss-collector/         # RSS 수집 Lambda
│   └── translator/            # 번역+검수 Lambda
├── scripts/
│   └── migrate-from-netlify.js  # 데이터 마이그레이션 (일회성)
├── src/
│   ├── pages/
│   │   ├── index.astro        # 메인 대시보드
│   │   └── api/               # Astro API routes
│   ├── components/            # Cloudscape 카드 등
│   └── layouts/
├── amplify.yml                # Amplify 빌드 설정
└── .env.example
```

## 설정

| 환경변수 | 설명 | 기본값 |
|---------|------|--------|
| `TABLE_NAME` | DynamoDB 테이블명 | SAM 자동 생성 |
| `QUEUE_URL` | SQS 큐 URL | SAM 자동 생성 |
| `BEDROCK_TRANSLATE_MODEL` | 번역 모델 | `apac.amazon.nova-micro-v1:0` |
| `BEDROCK_REVIEW_MODEL` | 검수 모델 | `apac.amazon.nova-lite-v1:0` |

## 라이선스

MIT
