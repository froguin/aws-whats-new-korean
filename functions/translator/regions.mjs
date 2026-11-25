// Region text normalization for the `regions` attribute.
//
// The translator stores either the literal '모든 AWS 리전', an unresolved '<service> 가용 리전'
// marker (filled in later by the region resolver), or a comma-separated list of commercial
// region names. The model does not always stick to that: it writes variants of "all regions",
// near-miss names ('캐나다(캘거리)', '남미(상파울루)'), other partitions (GovCloud, European
// Sovereign Cloud), or text that is not a region at all. canonicalizeRegions() maps all of that
// onto the three allowed shapes, so the site's region filter and the shared name table agree.
//
// Imported by the translator Lambda (shipped next to index.mjs) and by
// scripts/normalize-regions.mjs, which rewrites existing items with the same rules.

export const ALL_REGIONS = '모든 AWS 리전';

// Commercial region code -> Korean name. Same names as src/App.tsx REGION_NAMES and
// functions/region-resolver/handler.js REGION_MAP (those also list other partitions).
export const COMMERCIAL_REGIONS = {
  'us-east-1': '미국 동부(버지니아 북부)', 'us-east-2': '미국 동부(오하이오)',
  'us-west-1': '미국 서부(북부 캘리포니아)', 'us-west-2': '미국 서부(오레곤)',
  'ap-northeast-1': '아시아 태평양(도쿄)', 'ap-northeast-2': '아시아 태평양(서울)',
  'ap-northeast-3': '아시아 태평양(오사카)', 'ap-southeast-1': '아시아 태평양(싱가포르)',
  'ap-southeast-2': '아시아 태평양(시드니)', 'ap-southeast-3': '아시아 태평양(자카르타)',
  'ap-southeast-4': '아시아 태평양(멜버른)', 'ap-southeast-5': '아시아 태평양(말레이시아)',
  'ap-southeast-6': '아시아 태평양(뉴질랜드)', 'ap-southeast-7': '아시아 태평양(태국)',
  'ap-south-1': '아시아 태평양(뭄바이)', 'ap-south-2': '아시아 태평양(하이데라바드)',
  'ap-east-1': '아시아 태평양(홍콩)', 'ap-east-2': '아시아 태평양(타이베이)',
  'eu-west-1': '유럽(아일랜드)', 'eu-west-2': '유럽(런던)', 'eu-west-3': '유럽(파리)',
  'eu-central-1': '유럽(프랑크푸르트)', 'eu-central-2': '유럽(취리히)',
  'eu-north-1': '유럽(스톡홀름)', 'eu-south-1': '유럽(밀라노)', 'eu-south-2': '유럽(스페인)',
  'ca-central-1': '캐나다(중부)', 'ca-west-1': '캐나다 서부(캘거리)',
  'sa-east-1': '남아메리카(상파울루)',
  'mx-central-1': '멕시코(중부)',
  'me-south-1': '중동(바레인)', 'me-central-1': '중동(UAE)',
  'af-south-1': '아프리카(케이프타운)', 'il-central-1': '이스라엘(텔아비브)',
};
const NAMES = new Set(Object.values(COMMERCIAL_REGIONS));

// '(도시)' part of each commercial name -> full name, for near-miss prefixes such as
// '캐나다(캘거리)' or '남미(상파울루)'. Only cities that occur once are used.
const BY_CITY = (() => {
  const m = new Map(), dup = new Set();
  for (const n of NAMES) {
    const c = n.match(/\(([^)]+)\)$/)?.[1];
    if (!c) continue;
    if (m.has(c)) dup.add(c); else m.set(c, n);
  }
  for (const c of dup) m.delete(c);
  return m;
})();

const SERVICE_MARKER = /^\S+ 가용 리전$/;
// "all regions" in any wording: 모든 AWS 리전 / 모든 상용 AWS 리전 / 모든 AWS 상용 리전 /
// 모든 상업용 및 AWS GovCloud(미국) 리전 / 지원하는 AWS 서비스 전체 ...
const ALL_PHRASE = /(모든|전체)/;
// Other partitions: China, GovCloud, European Sovereign Cloud (Germany has no commercial region).
const OTHER_PARTITION = /(govcloud|중국|china|주권|sovereign|^유럽\(독일\)$|^(cn|us-gov|eusc)-)/i;
const REGION_CODE = /^[a-z]{2}-[a-z]+-\d$/;

// Returns { value, dropped }: `value` is what to store, `dropped` lists the parts that were
// removed as not a commercial region (for logging).
export function canonicalizeRegions(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return { value: ALL_REGIONS, dropped: [] };
  if (SERVICE_MARKER.test(text) || text.startsWith('__SERVICE__:')) return { value: text, dropped: [] };

  const parts = text.split(/[,;]/).map(s => s.trim()).filter(Boolean);
  const kept = [], dropped = [];
  let all = false, otherPartition = false;
  for (const p of parts) {
    if (NAMES.has(p)) { kept.push(p); continue; }
    if (REGION_CODE.test(p) && COMMERCIAL_REGIONS[p]) { kept.push(COMMERCIAL_REGIONS[p]); continue; }
    // "all commercial (and GovCloud) regions" counts as all regions, before the partition check.
    if (ALL_PHRASE.test(p)) { all = true; continue; }
    if (OTHER_PARTITION.test(p)) { otherPartition = true; dropped.push(p); continue; }
    const city = p.match(/\(([^)]+)\)$/)?.[1];
    if (city && BY_CITY.has(city)) { kept.push(BY_CITY.get(city)); continue; }
    dropped.push(p);
  }
  if (all) return { value: ALL_REGIONS, dropped };
  const unique = [...new Set(kept)];
  if (unique.length) return { value: unique.join(', '), dropped };
  // Nothing commercial left. Only another partition (GovCloud-only launch) -> no regions.
  // Text that is not a region at all -> also no regions rather than a guessed '모든 AWS 리전'.
  return { value: '', dropped, otherPartitionOnly: otherPartition };
}
