import React, { useEffect, useState } from 'react';
import {
  AppLayout, Table, Box, SplitPanel,
  SpaceBetween, Link, TextFilter, Pagination, StatusIndicator,
  TopNavigation,
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
function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '방금 전';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

export default function App() {
  const [items, setItems] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Article[]>([]);
  const [splitOpen, setSplitOpen] = useState(false);
  const ps = 30;
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
  const latestDate = items[0]?.pubDate;
  const detail = selected[0];

  return <>
    <TopNavigation
      identity={{ href: '/', title: "AWS What's New 한국어 요약" }}
      utilities={[
        { type: 'button', iconSvg: dark
            ? <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="20" height="20"><path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z"/></svg>
            : <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="20" height="20"><circle cx="10" cy="10" r="4"/><path d="M10 1v2m0 14v2m-7-9H1m18 0h-2m-1.3-5.3l-1.4 1.4M5.7 14.3l-1.4 1.4m0-11.4l1.4 1.4m8.6 8.6l1.4 1.4"/></svg>,
          title: dark ? '다크 모드' : '라이트 모드', onClick: () => setDark(d => !d), disableUtilityCollapse: true },
        { type: 'button', text: 'GitHub', href: 'https://github.com/froguin/aws-whats-new-korean', external: true, disableUtilityCollapse: true },
      ]}
    />
    <AppLayout
      navigationHide
      toolsHide
      splitPanelOpen={splitOpen}
      onSplitPanelToggle={({ detail }) => setSplitOpen(detail.open)}
      splitPanelPreferences={{ position: 'side' }}
      splitPanelSize={450}
      splitPanel={
        detail ? (
          <SplitPanel header={detail.title || detail.titleEn} hidePreferencesButton closeBehavior="hide"
            i18nStrings={{ preferencesTitle: '', preferencesPositionLabel: '', preferencesPositionDescription: '', preferencesPositionSide: '', preferencesPositionBottom: '', preferencesConfirm: '', preferencesCancel: '', closeButtonAriaLabel: '닫기', openButtonAriaLabel: '열기', resizeHandleAriaLabel: '' }}>
            <SpaceBetween size="m">
              {detail.titleEn && detail.title !== detail.titleEn && (
                <Box color="text-body-secondary" fontSize="body-s">{detail.titleEn}</Box>
              )}
              <SpaceBetween direction="horizontal" size="xs">
                <StatusIndicator type={statusType(detail.status)}>{fmtStatus(detail.status)}</StatusIndicator>
                <Box color="text-body-secondary" fontSize="body-s">
                  {detail.pubDate ? new Date(detail.pubDate).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' }) : ''}
                </Box>
              </SpaceBetween>
              <Box>
                <Box variant="awsui-key-label">요약</Box>
                <Box>{fmtSummary(detail.summary) || '요약 없음'}</Box>
              </Box>
              {detail.target && <Box><Box variant="awsui-key-label">대상</Box><Box>{detail.target}</Box></Box>}
              {detail.features && <Box><Box variant="awsui-key-label">주요 기능</Box><Box>{detail.features}</Box></Box>}
              {detail.regions && <Box><Box variant="awsui-key-label">리전</Box><Box>{detail.regions}</Box></Box>}
              <Link href={detail.url} external>원문 보기</Link>
            </SpaceBetween>
          </SplitPanel>
        ) : null
      }
      content={
        <Table
          loading={loading}
          loadingText="업데이트를 불러오는 중..."
          items={paged}
          onRowClick={({ detail }) => { setSelected([detail.item]); setSplitOpen(true); }}
          stickyHeader
          variant="full-page"
          header={
            <Box padding={{ bottom: 'xs' }}>
              <Box color="text-body-secondary" fontSize="body-m">
                AWS 공식 릴리스 노트를 한국어로 자동 번역·검수하여 보여줍니다.{' '}<span className="desc-break" />현재 {filtered.length}개의 새 소식이 있습니다.{latestDate ? ` 최근 업데이트: ${timeAgo(latestDate)}` : ''}
              </Box>
            </Box>
          }
          filter={<TextFilter filteringText={filter} filteringPlaceholder="키워드로 검색" onChange={({detail}) => { setFilter(detail.filteringText); setPage(1); }} />}
          pagination={<Pagination currentPageIndex={page} pagesCount={Math.ceil(filtered.length/ps)||1} onChange={({detail}) => setPage(detail.currentPageIndex)} />}
          columnDefinitions={[
            {
              id: 'pubDate', header: '날짜', width: 100,
              cell: item => item.pubDate ? new Date(item.pubDate).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }) : '',
              sortingField: 'pubDate',
            },
            {
              id: 'status', header: '상태', width: 110,
              cell: item => <StatusIndicator type={statusType(item.status)}>{fmtStatus(item.status)}</StatusIndicator>,
            },
            {
              id: 'title', header: '제목',
              cell: item => (
                <Box>
                  <Box>{item.title || item.titleEn}</Box>
                  {fmtSummary(item.summary) && <Box color="text-body-secondary" fontSize="body-s">{fmtSummary(item.summary).length > 80 ? fmtSummary(item.summary).slice(0, 80) + '…' : fmtSummary(item.summary)}</Box>}
                </Box>
              ),
              sortingField: 'title',
            },
          ]}
          empty={<Box textAlign="center" padding="l">{API_URL ? '표시할 업데이트가 없습니다.' : 'API URL이 설정되지 않았습니다.'}</Box>}
        />
      }
    />
    <Box textAlign="center" padding="l" color="text-body-secondary" fontSize="body-s">
      © {new Date().getFullYear()} AWS What's New 한국어 요약. This is not an official AWS product or project.
    </Box>
  </>;
}
