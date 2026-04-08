import React, { useEffect, useState } from 'react';
import {
  AppLayout, ContentLayout, Header, Cards, Box,
  SpaceBetween, Link, TextFilter, Pagination, StatusIndicator,
  TopNavigation, Toggle,
} from '@cloudscape-design/components';
import { applyMode, Mode } from '@cloudscape-design/global-styles';

const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

interface Article {
  id: string; title: string; titleEn: string;
  summary: string; description: string;
  target: string; features: string; regions: string;
  status: string; url: string; pubDate: string;
}

function fmtStatus(s: string) {
  try { return s.replace(/[\[\]"]/g, '').trim() || '정식 출시'; } catch { return '정식 출시'; }
}
function statusType(s: string): 'success'|'info'|'warning'|'error' {
  const v = fmtStatus(s);
  if (v.includes('미리보기')) return 'info';
  if (v.includes('베타')) return 'warning';
  if (v.includes('지원 종료')) return 'error';
  return 'success';
}
function fmtSummary(s: any): string {
  if (!s) return '';
  if (typeof s === 'string') return s;
  return [s.what_changed, s.why_it_matters].filter(Boolean).join(' ');
}

export default function App() {
  const [items, setItems] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const ps = 12;
  const [dark, setDark] = useState(() => {
    const s = localStorage.getItem('theme');
    return s ? s === 'dark' : matchMedia('(prefers-color-scheme:dark)').matches;
  });

  useEffect(() => { applyMode(dark ? Mode.Dark : Mode.Light); localStorage.setItem('theme', dark ? 'dark' : 'light'); }, [dark]);
  useEffect(() => {
    if (!API_URL) { setLoading(false); return; }
    fetch(`${API_URL}/articles?limit=200`).then(r => r.json()).then(d => { setItems(d.items || []); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const filtered = items.filter(a => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (a.title||'').toLowerCase().includes(q) || (a.titleEn||'').toLowerCase().includes(q) || fmtSummary(a.summary).toLowerCase().includes(q);
  });
  const paged = filtered.slice((page-1)*ps, page*ps);

  return <>
    <TopNavigation
      identity={{ href: '/', title: "AWS What's New 한국어 요약" }}
      utilities={[
        { type: 'button', iconSvg: dark
            ? <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="20" height="20"><path d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z"/></svg>
            : <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="20" height="20"><path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z"/></svg>,
          title: dark ? '라이트 모드' : '다크 모드', onClick: () => setDark(d => !d) },
        { type: 'button', text: 'GitHub', href: 'https://github.com/froguin/aws-whats-new-korean', external: true, disableTextWrapping: true },
      ]}
    />
    <AppLayout navigationHide toolsHide content={
      <ContentLayout header={
        <Header variant="h1" description="AWS 공식 릴리스 노트를 한국어로 자동 번역·검수하여 보여줍니다." counter={`(${filtered.length})`}>
          AWS What's New 한국어 요약
        </Header>
      }>
        <Cards loading={loading} loadingText="업데이트를 불러오는 중..."
          items={paged}
          filter={<TextFilter filteringText={filter} filteringPlaceholder="키워드로 검색" onChange={({detail}) => { setFilter(detail.filteringText); setPage(1); }} />}
          pagination={<Pagination currentPageIndex={page} pagesCount={Math.ceil(filtered.length/ps)||1} onChange={({detail}) => setPage(detail.currentPageIndex)} />}
          cardDefinition={{
            header: item => <Link href={item.url} external fontSize="heading-m">{item.title || item.titleEn}</Link>,
            sections: [
              { id: 'meta', header: '상태', content: item => (
                <SpaceBetween direction="horizontal" size="xs">
                  <StatusIndicator type={statusType(item.status)}>{fmtStatus(item.status)}</StatusIndicator>
                  <Box color="text-body-secondary" fontSize="body-s">
                    {item.pubDate ? new Date(item.pubDate).toLocaleDateString('ko-KR',{year:'numeric',month:'short',day:'numeric'}) : ''}
                  </Box>
                </SpaceBetween>
              )},
              { id: 'summary', header: '요약', content: item => {
                const s = fmtSummary(item.summary);
                return s ? <Box>{s}</Box> : null;
              }},
              { id: 'target', header: '대상', content: item => item.target ? <Box color="text-body-secondary" fontSize="body-s">{item.target}</Box> : null },
              { id: 'features', header: '주요 기능', content: item => item.features ? <Box color="text-body-secondary" fontSize="body-s">{item.features}</Box> : null },
              { id: 'regions', header: '리전', content: item => item.regions ? <Box color="text-body-secondary" fontSize="body-s">{item.regions}</Box> : null },
            ],
          }}
          empty={<Box textAlign="center" padding="l">{API_URL ? '표시할 업데이트가 없습니다.' : 'API URL이 설정되지 않았습니다.'}</Box>}
        />
      </ContentLayout>
    } />
    <Box textAlign="center" padding="l" color="text-body-secondary" fontSize="body-s">
      © {new Date().getFullYear()} AWS What's New 한국어 요약. This is not an official AWS product or project.
    </Box>
  </>;
}
