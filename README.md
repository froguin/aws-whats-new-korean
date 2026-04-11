# AWS What's New 한국어 요약

[![Live Demo](https://img.shields.io/badge/demo-live-brightgreen)](https://release.awskr.net)

AWS 공식 [What's New](https://aws.amazon.com/new/) 릴리스 노트를 Amazon Bedrock으로 자동 번역·검수하여 한국어로 보여주는 서버리스 애플리케이션입니다.

## 주요 기능

- 15분 주기 RSS 자동 수집
- Nova Lite로 번역 → Nova Micro로 AI 검수 (2단계 파이프라인)
- 품질 게이트: CJK 오염, 빈 필드, 제목 품질 자동 감지 및 재시도
- 리전 자동 추출: 원문 description에서 정규식으로 개별 리전 추출 → 32개 영한 매핑 테이블로 정규화
- Cloudscape Design System 기반 반응형 UI
  - PC: Table + PropertyFilter + CollectionPreferences + SplitPanel(bottom)
  - 모바일: Cards + 전체화면 상세 뷰
  - 다크 모드, Amazon Ember 폰트
- 완전 서버리스 — 월 $1 미만 운영 가능

## 아키텍처

```
EventBridge (15분 크론)
  → Lambda: RSS 수집 → DynamoDB 저장 → SQS 큐잉

SQS → Lambda:
  → Bedrock Nova Lite: 번역 (제목·요약·상태·대상·기능)
  → 리전 자동 추출 (description에서 정규식 + 매핑 테이블)
  → 품질 게이트: 필수 필드 검증, CJK 오염 감지 → 재시도
  → Bedrock Nova Micro: AI 검수 (필드별 교차 검증, 오류 시 수정)
  → DynamoDB 저장

Amplify Gen 2 (React SPA + CDK 백엔드)
  → Cloudscape 대시보드
  → API Gateway HTTP API (자동 배포)
     ├─ GET /articles  기사 조회
     └─ GET /stats     파이프라인 상태
```

## 비용

| 서비스 | 프리티어 | 예상 사용량 |
|--------|---------|------------|
| Lambda | 1M req/월 | ~3K/월 |
| DynamoDB | 25GB, 25 RCU/WCU | ~50MB |
| SQS | 1M msg/월 | ~3K/월 |
| EventBridge | 무료 | 크론 1개 |
| Amplify Hosting | 빌드 1000분/월 | ~10분/배포 |
| Bedrock (Nova Lite + Micro) | 종량제 | **~$0.50/월** |

## 사전 요구사항

- AWS CLI v2
- Node.js 22+
- Bedrock 모델 접근 활성화 (Nova Lite, Nova Micro) — `ap-northeast-2` 리전

## 배포

```bash
# Amplify Console에서 GitHub 레포 연결
# → git push 시 프론트엔드 + 백엔드 자동 배포 (amplify.yml)
# → API Gateway URL은 amplify_outputs.json에서 자동 주입
```

## 로컬 개발

```bash
npm install
npm run dev              # Vite 개발 서버 (localhost:5173)
npx ampx sandbox         # 백엔드 샌드박스 (DynamoDB, SQS, Lambda)
```

## 프로젝트 구조

```
├── amplify/
│   ├── backend.ts             # Amplify Gen 2 백엔드 (CDK)
│   └── functions/
│       ├── rss-collector/     # RSS 수집 (15분 크론)
│       ├── translator/        # 번역 + 검수 + 리전 추출 (SQS trigger)
│       └── api/               # API (API Gateway HTTP API → Lambda)
├── src/
│   ├── App.tsx                # 메인 대시보드 (PC: Table, 모바일: Cards)
│   ├── main.tsx               # 엔트리포인트
│   └── fonts.css              # Amazon Ember 폰트 + Cloudscape 오버라이드
└── amplify.yml                # Amplify 빌드 설정 (node_modules 캐시)
```

## 설정

| 환경변수 | 설명 | 기본값 |
|---------|------|--------|
| `VITE_API_URL` | API Gateway URL | `amplify_outputs.json`에서 자동 주입 |
| `BEDROCK_TRANSLATE_MODEL` | 번역 모델 | `apac.amazon.nova-lite-v1:0` |
| `BEDROCK_REVIEW_MODEL` | 검수 모델 | `apac.amazon.nova-micro-v1:0` |

## 기존 데이터 재번역

```bash
TABLE_NAME=<테이블명> QUEUE_URL=<큐 URL> node scripts/retranslate-existing.cjs
```

옵션:
- `DRY_RUN=1` — 실제 전송 없이 대상 건수만 확인
- `LIMIT=500` — 최대 500건만 재큐잉

## 라이선스

MIT
