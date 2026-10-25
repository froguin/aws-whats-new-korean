# AWS 새로운 소식 한국어 요약

[![Live Demo](https://img.shields.io/badge/demo-live-brightgreen)](https://whats-new.awskr.net)

AWS 공식 [새로운 소식(What's New)](https://aws.amazon.com/new/) 발표를 Amazon Bedrock으로 자동 번역·검수하여 한국어로 보여주는 서버리스 애플리케이션입니다.

- 라이브: https://whats-new.awskr.net (별칭: https://whatsnew.awskr.net)

## 주요 기능

- 15분 주기 RSS 자동 수집
- Nova Lite로 번역 → Nova Micro로 AI 검수 (2단계 파이프라인)
- 품질 게이트: CJK 오염, 빈 필드, 제목 품질 자동 감지 및 재시도
- 리전 자동 추출: 원문 description에서 정규식으로 개별 리전 추출 → 영한 매핑 테이블로 정규화
- Cloudscape Design System 기반 반응형 UI
  - PC: Table + PropertyFilter + CollectionPreferences + SplitPanel(bottom)
  - 모바일: Cards + 전체화면 상세 뷰
  - 다크 모드, Amazon Ember 폰트
- 완전 서버리스 — 프리티어 한도 안에서 운영 (Bedrock 종량제만 과금)

## 아키텍처

프런트엔드(정적 SPA)와 백엔드(데이터 파이프라인)를 분리했습니다. 프런트엔드는 S3 + CloudFront(정액제)로, 백엔드는 독립 CloudFormation 스택으로 운영합니다.

```
백엔드  (EventBridge + Lambda + DynamoDB + SQS, ap-northeast-2)
  EventBridge Scheduler (15분)
    → Lambda rss-collector  → DynamoDB 저장 → SQS 큐잉
  SQS → Lambda translator
    → Bedrock Nova Lite: 번역 (제목·요약·상태·대상·기능)
    → 리전 자동 추출 (description 정규식 + 매핑 테이블)
    → 품질 게이트: 필수 필드 검증, CJK 오염 감지 → 재시도 → 실패 시 DLQ
    → Bedrock Nova Micro: AI 검수 (필드별 교차 검증)
    → DynamoDB 저장
  EventBridge Scheduler (15분)
    → Lambda publisher → 번역 완료 기사 전체를 articles.json 으로 사이트 버킷에 기록

프런트엔드
  Vite + React + Cloudscape SPA (정적 빌드)
    → S3 + CloudFront (정액제, whats-new.awskr.net)
    → 같은 도메인의 /articles.json 한 개만 읽음 (방문자는 Lambda·DynamoDB를 호출하지 않음)
```

## 비용 (프리티어 설계)

| 서비스 | 프리티어 | 예상 사용량 |
|--------|---------|------------|
| Lambda | 40만 GB-초/월 | ~2.6K GB-초/월 |
| DynamoDB | 25 RCU + 25 WCU (상시) | 프로비저닝 10/10 테이블 + 10/10 인덱스 |
| SQS | 1M msg/월 | ~3K/월 |
| EventBridge | 무료 | 스케줄 2개 (수집·게시) |
| CloudFront | 정액제 플랜 | 1개 배포 |
| Bedrock (Nova Lite + Micro) | 종량제 | **~$0.50/월** |

## 사전 요구사항

- AWS CLI v2, Node.js 22+
- Bedrock 모델 접근 활성화 (Nova Lite, Nova Micro) — `ap-northeast-2`

## 배포

### 백엔드 (`infra/backend/`)

`functions/**` 또는 `infra/backend/**` 변경을 `main`에 푸시하면 GitHub Actions가 Lambda 패키징 → CloudFormation 배포 → `articles.json` 즉시 시드를 자동으로 수행합니다. 초기 IAM/OIDC 설정과 수동 복구 절차는 [`infra/backend/README.md`](infra/backend/README.md)를 따르세요.

### 프런트엔드 (`infra/site/`)

프런트엔드는 `main` push가 주 배포 경로입니다 — GitHub Actions가 Vite 빌드 후 S3 게시 + CloudFront 무효화를 수행합니다. S3/CloudFront 스택 자체(생성·갱신)는 아래로 배포합니다.

```bash
infra/deploy-site.sh infra/site/params.env   # 사이트 스택(S3 + CloudFront) 생성/갱신
```

## 로컬 개발

```bash
npm install
npm run dev              # Vite 개발 서버 (localhost:5173)
```

## 프로젝트 구조

```
├── functions/                  # Lambda 핸들러 소스 (rss-collector, translator, region-resolver, publisher, api)
├── src/                        # React SPA (App.tsx, main.tsx, fonts.css)
├── infra/
│   ├── backend/                # 백엔드 스택 (template.yaml, package.sh, deploy.sh, requeue-pending.py)
│   ├── site/                   # 프런트 S3+CloudFront 스택 (template.yaml, params.env)
│   ├── deploy-site.sh          # 사이트 스택 배포
│   └── dns-cutover.sh          # Route 53 A/AAAA ALIAS 전환
└── .github/workflows/          # 빌드·배포 워크플로
```

## 설정

| 환경변수 | 설명 | 기본값 |
|---------|------|--------|
| `BEDROCK_TRANSLATE_MODEL` | 번역 모델 | `apac.amazon.nova-lite-v1:0` |
| `BEDROCK_REVIEW_MODEL` | 검수 모델 | `apac.amazon.nova-micro-v1:0` |

## 라이선스

MIT
