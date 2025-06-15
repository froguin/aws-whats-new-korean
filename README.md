# AWS What's New 한국어 요약

AWS의 최신 업데이트를 한국어로 요약해서 제공하는 웹 애플리케이션입니다. AWS Bedrock의 Nova Micro 모델을 사용하여 자동으로 번역 및 요약합니다.

## 🏗️ 아키텍처

### AWS 기반 인프라
- **호스팅**: AWS Amplify 또는 S3 + CloudFront
- **API**: API Gateway + Lambda Functions
- **데이터베이스**: DynamoDB (캐시용)
- **AI 서비스**: AWS Bedrock (Nova Micro)
- **프론트엔드**: Astro (정적 사이트)

### 주요 구성 요소
```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   사용자        │───▶│  CloudFront      │───▶│   S3 Bucket     │
│   (브라우저)    │    │  (CDN)           │    │   (정적 사이트)  │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌──────────────────┐
                       │  API Gateway     │
                       └──────────────────┘
                                │
                                ▼
                       ┌──────────────────┐    ┌─────────────────┐
                       │  Lambda Function │───▶│   DynamoDB      │
                       │  (fetch-updates) │    │   (캐시)        │
                       └──────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌──────────────────┐
                       │  AWS Bedrock     │
                       │  (Nova Micro)    │
                       └──────────────────┘
```

## 🚀 배포 가이드

### 사전 요구사항
- AWS CLI 설치 및 구성
- Node.js 18+ 설치
- jq 설치 (JSON 파싱용)

### 1. 환경 설정
```bash
# 환경 변수 설정
export AWS_REGION=us-east-1
export ENVIRONMENT=prod

# AWS 자격 증명 확인
aws sts get-caller-identity
```

### 2. 자동 배포
```bash
# 전체 인프라 및 애플리케이션 배포
./deploy.sh
```

### 3. 수동 배포 (단계별)

#### 3.1 인프라 배포
```bash
aws cloudformation deploy \
  --template-file aws-infrastructure/cloudformation.yaml \
  --stack-name aws-whats-new-infrastructure-prod \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides Environment=prod
```

#### 3.2 Lambda 함수 배포
```bash
cd aws-lambda/fetch-updates
npm install
zip -r ../fetch-updates.zip .
cd ../..

aws lambda create-function \
  --function-name aws-whats-new-fetch-updates-prod \
  --runtime nodejs18.x \
  --role arn:aws:iam::ACCOUNT:role/lambda-role \
  --handler index.handler \
  --zip-file fileb://aws-lambda/fetch-updates.zip
```

#### 3.3 정적 사이트 빌드 및 배포
```bash
npm install
npm run build

# S3에 배포 (선택사항)
aws s3 sync dist/ s3://your-bucket-name --delete
```

## 🛠️ 개발 환경 설정

### 로컬 개발
```bash
# 의존성 설치
npm install

# 개발 서버 시작
npm run dev

# 빌드
npm run build

# 미리보기
npm run preview
```

### 환경 변수 설정
`.env` 파일을 생성하고 다음 변수들을 설정하세요:

```env
# AWS 설정
AWS_REGION=us-east-1
DYNAMODB_TABLE=aws-updates-cache-prod

# API Gateway URL
PUBLIC_API_URL=https://your-api-gateway-url.amazonaws.com/prod

# 로컬 개발용 AWS 자격 증명 (선택사항)
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
```

## 📁 프로젝트 구조

```
/
├── aws-infrastructure/          # CloudFormation 템플릿
│   └── cloudformation.yaml
├── aws-lambda/                  # Lambda 함수들
│   └── fetch-updates/
│       ├── index.js
│       └── package.json
├── src/                         # Astro 소스 코드
│   ├── components/
│   ├── layouts/
│   └── pages/
├── public/                      # 정적 자산
├── deploy.sh                    # 배포 스크립트
├── astro.config.mjs            # Astro 설정
└── package.json
```

## 🔧 주요 명령어

| 명령어 | 설명 |
|--------|------|
| `npm run dev` | 개발 서버 시작 |
| `npm run build` | 프로덕션 빌드 |
| `npm run preview` | 빌드 미리보기 |
| `./deploy.sh` | 전체 배포 |
| `npm run deploy:infrastructure` | 인프라만 배포 |
| `npm run deploy:lambda` | Lambda 함수만 배포 |

## 🔄 마이그레이션 히스토리

### Netlify → AWS 마이그레이션
- **이전**: Netlify Functions + Netlify Blobs
- **현재**: API Gateway + Lambda + DynamoDB
- **장점**: 
  - 더 나은 확장성
  - AWS 생태계 통합
  - 비용 최적화
  - 더 세밀한 제어

## 🚨 문제 해결

### 일반적인 문제들

1. **Lambda 함수 타임아웃**
   - 타임아웃을 300초로 증가
   - 메모리를 512MB로 설정

2. **CORS 오류**
   - API Gateway에서 CORS 설정 확인
   - Lambda 함수에서 적절한 헤더 반환

3. **DynamoDB 권한 오류**
   - Lambda 실행 역할에 DynamoDB 권한 확인
   - 테이블 이름 환경 변수 확인

### 로그 확인
```bash
# Lambda 함수 로그
aws logs tail /aws/lambda/aws-whats-new-fetch-updates-prod --follow

# CloudFormation 스택 이벤트
aws cloudformation describe-stack-events --stack-name aws-whats-new-infrastructure-prod
```

## 📊 모니터링

- **CloudWatch**: Lambda 함수 메트릭 및 로그
- **X-Ray**: 분산 추적 (선택사항)
- **API Gateway**: API 호출 메트릭

## 🤝 기여하기

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 라이선스

이 프로젝트는 MIT 라이선스 하에 있습니다.
