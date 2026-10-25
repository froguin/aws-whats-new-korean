import { SSMClient, GetParametersByPathCommand } from '@aws-sdk/client-ssm';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const TABLE = process.env.TABLE_NAME;
const ssm = new SSMClient({ region: 'us-east-1' }); // global-infrastructure data is only in us-east-1
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const REGION_MAP = {
  'us-east-1': '미국 동부(버지니아 북부)', 'us-east-2': '미국 동부(오하이오)',
  'us-west-1': '미국 서부(북부 캘리포니아)', 'us-west-2': '미국 서부(오레곤)',
  'ap-northeast-1': '아시아 태평양(도쿄)', 'ap-northeast-2': '아시아 태평양(서울)',
  'ap-northeast-3': '아시아 태평양(오사카)', 'ap-southeast-1': '아시아 태평양(싱가포르)',
  'ap-southeast-2': '아시아 태평양(시드니)', 'ap-southeast-3': '아시아 태평양(자카르타)',
  'ap-southeast-4': '아시아 태평양(멜버른)', 'ap-southeast-5': '아시아 태평양(말레이시아)',
  'ap-south-1': '아시아 태평양(뭄바이)', 'ap-south-2': '아시아 태평양(하이데라바드)',
  'ap-east-1': '아시아 태평양(홍콩)', 'ap-east-2': '아시아 태평양(타이베이)',
  'eu-west-1': '유럽(아일랜드)', 'eu-west-2': '유럽(런던)', 'eu-west-3': '유럽(파리)',
  'eu-central-1': '유럽(프랑크푸르트)', 'eu-central-2': '유럽(취리히)',
  'eu-north-1': '유럽(스톡홀름)', 'eu-south-1': '유럽(밀라노)', 'eu-south-2': '유럽(스페인)',
  'ca-central-1': '캐나다(중부)', 'ca-west-1': '캐나다 서부(캘거리)',
  'sa-east-1': '남아메리카(상파울루)',
  'me-south-1': '중동(바레인)', 'me-central-1': '중동(UAE)',
  'af-south-1': '아프리카(케이프타운)', 'il-central-1': '이스라엘(텔아비브)',
  'us-gov-west-1': 'AWS GovCloud(미국-서부)', 'us-gov-east-1': 'AWS GovCloud(미국-동부)',
  'cn-north-1': '중국(베이징)', 'cn-northwest-1': '중국(닝샤)',
};

async function getServiceRegions(serviceName) {
  const regions = [];
  let nextToken;
  do {
    const resp = await ssm.send(new GetParametersByPathCommand({
      Path: `/aws/service/global-infrastructure/services/${serviceName}/regions`,
      NextToken: nextToken,
    }));
    for (const p of resp.Parameters || []) regions.push(p.Value);
    nextToken = resp.NextToken;
  } while (nextToken);
  return regions;
}

export const handler = async (event) => {
  for (const rec of event.Records) {
    const { guid, service } = JSON.parse(rec.body);
    try {
      const regionIds = await getServiceRegions(service);
      if (regionIds.length === 0) {
        console.log(`NO_REGIONS ${guid}: service=${service}`);
        continue;
      }
      const regionNames = regionIds
        .map(id => REGION_MAP[id] || id)
        .filter(r => !r.startsWith('cn-') && !r.startsWith('us-gov-')) // 상용 리전만
        .sort();
      const regionsStr = regionNames.join(', ');

      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { pk: guid, sk: 'ARTICLE' },
        UpdateExpression: 'SET regions = :r',
        ExpressionAttributeValues: { ':r': regionsStr },
      }));
      console.log(`OK ${guid}: ${service} → ${regionNames.length} regions`);
    } catch (e) {
      console.error(`FAIL ${guid}:`, e.message);
      throw e;
    }
  }
};
