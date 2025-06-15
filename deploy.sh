#!/bin/bash

# AWS What's New Korean - 배포 스크립트

set -e

echo "🚀 AWS What's New Korean 배포 시작..."

# 환경 변수 확인
if [ -z "$AWS_REGION" ]; then
    export AWS_REGION="ap-northeast-2"
fi

if [ -z "$ENVIRONMENT" ]; then
    export ENVIRONMENT="prod"
fi

if [ -z "$AWS_PROFILE" ]; then
    export AWS_PROFILE="aws-whats-new"
fi

echo "📋 환경 설정:"
echo "  - AWS Region: $AWS_REGION"
echo "  - Environment: $ENVIRONMENT"
echo "  - AWS Profile: $AWS_PROFILE"

# 1. CloudFormation 스택 배포
echo "🏗️  인프라 배포 중..."
aws cloudformation deploy \
    --template-file aws-infrastructure/cloudformation.yaml \
    --stack-name aws-whats-new-infrastructure-$ENVIRONMENT \
    --capabilities CAPABILITY_NAMED_IAM \
    --parameter-overrides Environment=$ENVIRONMENT \
    --region $AWS_REGION \
    --profile $AWS_PROFILE

# 스택 출력값 가져오기
echo "📊 스택 정보 조회 중..."
STACK_OUTPUTS=$(aws cloudformation describe-stacks \
    --stack-name aws-whats-new-infrastructure-$ENVIRONMENT \
    --region $AWS_REGION \
    --profile $AWS_PROFILE \
    --query 'Stacks[0].Outputs' \
    --output json)

DYNAMODB_TABLE=$(echo $STACK_OUTPUTS | jq -r '.[] | select(.OutputKey=="DynamoDBTableName") | .OutputValue')
LAMBDA_ROLE_ARN=$(echo $STACK_OUTPUTS | jq -r '.[] | select(.OutputKey=="LambdaRoleArn") | .OutputValue')
API_GATEWAY_URL=$(echo $STACK_OUTPUTS | jq -r '.[] | select(.OutputKey=="ApiGatewayUrl") | .OutputValue')

echo "  - DynamoDB Table: $DYNAMODB_TABLE"
echo "  - Lambda Role: $LAMBDA_ROLE_ARN"
echo "  - API Gateway URL: $API_GATEWAY_URL"

# 2. Lambda 함수 패키징 및 배포
echo "📦 Lambda 함수 패키징 중..."
cd aws-lambda/fetch-updates
npm install --production
zip -r ../fetch-updates.zip . -x "*.git*" "node_modules/.cache/*"
cd ../..

# Lambda 함수 코드 업데이트 (CloudFormation에서 이미 생성됨)
FUNCTION_NAME=$(echo $STACK_OUTPUTS | jq -r '.[] | select(.OutputKey=="LambdaFunctionName") | .OutputValue')

echo "🔄 Lambda 함수 코드 업데이트 중..."
aws lambda update-function-code \
    --function-name $FUNCTION_NAME \
    --zip-file fileb://aws-lambda/fetch-updates.zip \
    --region $AWS_REGION \
    --profile $AWS_PROFILE

# 3. 정적 사이트 빌드
echo "🏗️  정적 사이트 빌드 중..."
npm install
npm run build

# 4. S3에 정적 사이트 배포 (선택사항)
if [ "$DEPLOY_TO_S3" = "true" ]; then
    echo "☁️  S3에 정적 사이트 배포 중..."
    if [ -z "$S3_BUCKET" ]; then
        echo "❌ S3_BUCKET 환경 변수가 설정되지 않았습니다."
        exit 1
    fi
    
    aws s3 sync dist/ s3://$S3_BUCKET --delete --region $AWS_REGION --profile $AWS_PROFILE
    
    # CloudFront 무효화 (선택사항)
    if [ -n "$CLOUDFRONT_DISTRIBUTION_ID" ]; then
        echo "🔄 CloudFront 캐시 무효화 중..."
        aws cloudfront create-invalidation \
            --distribution-id $CLOUDFRONT_DISTRIBUTION_ID \
            --paths "/*" \
            --profile $AWS_PROFILE
    fi
fi

echo "✅ 배포 완료!"
echo "🌍 API URL: $API_GATEWAY_URL"

# 환경 변수 파일 업데이트
echo "📝 환경 변수 파일 업데이트 중..."
cat > .env.production << EOF
AWS_REGION=$AWS_REGION
DYNAMODB_TABLE=$DYNAMODB_TABLE
PUBLIC_API_URL=$API_GATEWAY_URL
EOF

echo "🎉 모든 배포가 완료되었습니다!"
echo "📋 다음 단계:"
echo "  1. .env.production 파일을 확인하세요"
echo "  2. 프론트엔드에서 API URL을 업데이트하세요: $API_GATEWAY_URL"
echo "  3. 첫 번째 데이터 로드를 위해 Lambda 함수를 테스트하세요"
