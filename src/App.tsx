import React, { useEffect, useMemo, useState } from 'react';
import {
  AppLayout, Table, Cards, Box, SplitPanel,
  SpaceBetween, Link, TextFilter, Pagination, StatusIndicator,
  TopNavigation, Button,
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
function fmtDate(d: string) {
  if (!d) return '';
  const date = new Date(d);
  const thisYear = new Date().getFullYear();
  return date.getFullYear() === thisYear
    ? date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
    : date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' });
}
function useIsMobile() {
  const [mobile, setMobile] = useState(window.innerWidth <= 768);
  useEffect(() => {
    const h = () => setMobile(window.innerWidth <= 768);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  return mobile;
}

export default function App() {
  const [items, setItems] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Article[]>([]);
  const [splitOpen, setSplitOpen] = useState(false);
  const isMobile = useIsMobile();
  const ps = isMobile ? 12 : 30;
  const [dark, setDark] = useState(() => {
    const s = localStorage.getItem('theme');
    return s ? s === 'dark' : matchMedia('(prefers-color-scheme:dark)').matches;
  });

  useEffect(() => { applyMode(dark ? Mode.Dark : Mode.Light); localStorage.setItem('theme', dark ? 'dark' : 'light'); }, [dark]);

  const fetchData = () => {
    if (!API_URL) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    fetch(`${API_URL}/articles?limit=200`)
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then(d => { setItems(d.items || []); setLoading(false); })
      .catch(() => { setError('업데이트를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'); setLoading(false); });
  };
  useEffect(fetchData, []);

  const filtered = useMemo(() => items.filter(a => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (a.title||'').toLowerCase().includes(q) || (a.titleEn||'').toLowerCase().includes(q) || fmtSummary(a.summary).toLowerCase().includes(q);
  }), [items, filter]);
  const paged = useMemo(() => filtered.slice((page-1)*ps, page*ps), [filtered, page, ps]);
  const latestDate = items[0]?.pubDate;
  const detail = selected[0];

  const descText = filter
    ? `'${filter}' 검색 결과 ${filtered.length}건`
    : `현재 ${filtered.length}개의 새 소식이 있습니다.${latestDate ? ` 최근 업데이트: ${timeAgo(latestDate)}` : ''}`;

  const headerEl = (
    <Box padding={{ bottom: 'xs' }}>
      <Box color="text-body-secondary" fontSize="body-m">
        AWS 공식 릴리스 노트를 한국어로 자동 번역·요약하여 제공합니다.{isMobile ? <br /> : ' '}{descText}
      </Box>
    </Box>
  );
  const filterEl = <TextFilter filteringText={filter} filteringPlaceholder="제목, 서비스명으로 검색" filteringAriaLabel="업데이트 검색" onChange={({detail}) => { setFilter(detail.filteringText); setPage(1); }} />;
  const paginationEl = <Pagination currentPageIndex={page} pagesCount={Math.ceil(filtered.length/ps)||1} onChange={({detail}) => setPage(detail.currentPageIndex)} ariaLabels={{ nextPageLabel: '다음 페이지', previousPageLabel: '이전 페이지', pageLabel: p => `${p}페이지` }} />;

  const emptyEl = error
    ? <Box textAlign="center" padding="l"><SpaceBetween size="s"><Box>{error}</Box><Button onClick={fetchData}>다시 시도</Button></SpaceBetween></Box>
    : filter
      ? <Box textAlign="center" padding="l"><SpaceBetween size="s"><Box>검색 결과가 없습니다.</Box><Box color="text-body-secondary">다른 검색어를 입력하거나 필터를 지워 보세요.</Box></SpaceBetween></Box>
      : <Box textAlign="center" padding="l">{API_URL ? '표시할 업데이트가 없습니다.' : 'API URL이 설정되지 않았습니다.'}</Box>;

  const splitPanelContent = detail ? (
    <SplitPanel header={detail.title || detail.titleEn} hidePreferencesButton closeBehavior="hide"
      i18nStrings={{ preferencesTitle:'위치 설정', preferencesPositionLabel:'위치', preferencesPositionDescription:'패널 표시 위치를 선택합니다.', preferencesPositionSide:'오른쪽', preferencesPositionBottom:'아래쪽', preferencesConfirm:'확인', preferencesCancel:'취소', closeButtonAriaLabel:'상세 패널 닫기', openButtonAriaLabel:'상세 패널 열기', resizeHandleAriaLabel:'패널 크기 조절' }}>
      <SpaceBetween size="m">
        {detail.titleEn && detail.title !== detail.titleEn && (
          <Box color="text-body-secondary" fontSize="body-s">{detail.titleEn}</Box>
        )}
        <SpaceBetween direction="horizontal" size="xs">
          <StatusIndicator type={statusType(detail.status)}>{fmtStatus(detail.status)}</StatusIndicator>
          <Box color="text-body-secondary" fontSize="body-s">{fmtDate(detail.pubDate)}</Box>
        </SpaceBetween>
        <Box><Box variant="awsui-key-label">요약</Box><Box>{fmtSummary(detail.summary) || '요약 정보를 준비 중입니다.'}</Box></Box>
        {detail.target && <Box><Box variant="awsui-key-label">대상</Box><Box>{detail.target}</Box></Box>}
        {detail.features && <Box><Box variant="awsui-key-label">주요 기능</Box><Box>{detail.features}</Box></Box>}
        {detail.regions && <Box><Box variant="awsui-key-label">리전</Box><Box>{detail.regions}</Box></Box>}
        <Link href={detail.url} external>AWS 원문 보기</Link>
      </SpaceBetween>
    </SplitPanel>
  ) : (
    <SplitPanel header="상세 정보" hidePreferencesButton closeBehavior="hide"
      i18nStrings={{ preferencesTitle:'', preferencesPositionLabel:'', preferencesPositionDescription:'', preferencesPositionSide:'', preferencesPositionBottom:'', preferencesConfirm:'', preferencesCancel:'', closeButtonAriaLabel:'상세 패널 닫기', openButtonAriaLabel:'상세 패널 열기', resizeHandleAriaLabel:'패널 크기 조절' }}>
      <Box textAlign="center" color="text-body-secondary" padding="l">
        목록에서 항목을 선택하면 상세 내용이 여기에 표시됩니다.
      </Box>
    </SplitPanel>
  );

  const onSelect = ({ detail: d }: any) => {
    setSelected(d.selectedItems);
    setSplitOpen(d.selectedItems.length > 0);
  };

  const content = isMobile ? (
    <Cards loading={loading} loadingText="업데이트를 불러오는 중..."
      items={paged}
      selectionType="single"
      selectedItems={selected}
      onSelectionChange={onSelect}
      header={headerEl}
      filter={filterEl}
      pagination={paginationEl}
      ariaLabels={{ itemSelectionLabel: (_d, item) => (item as Article).title, selectionGroupLabel: '기사 선택' }}
      cardDefinition={{
        header: item => <Box fontWeight="bold" fontSize="body-m">{item.title || item.titleEn}</Box>,
        sections: [
          { id: 'meta', content: item => (
            <SpaceBetween direction="horizontal" size="xs">
              <StatusIndicator type={statusType(item.status)}>{fmtStatus(item.status)}</StatusIndicator>
              <Box color="text-body-secondary" fontSize="body-s">{fmtDate(item.pubDate)}</Box>
            </SpaceBetween>
          )},
        ],
      }}
      empty={emptyEl}
    />
  ) : (
    <Table loading={loading} loadingText="업데이트를 불러오는 중..."
      items={paged}
      selectionType="single"
      selectedItems={selected}
      onSelectionChange={onSelect}
      onRowClick={({ detail: d }) => { setSelected([d.item]); setSplitOpen(true); }}
      stickyHeader
      variant="full-page"
      header={headerEl}
      filter={filterEl}
      pagination={paginationEl}
      ariaLabels={{ itemSelectionLabel: (_d, item) => (item as Article).title, selectionGroupLabel: '기사 선택', tableLabel: 'AWS 릴리스 노트 목록' }}
      columnDefinitions={[
        { id: 'pubDate', header: '날짜', width: 120, cell: item => fmtDate(item.pubDate), sortingField: 'pubDate' },
        { id: 'status', header: '상태', width: 110, cell: item => <StatusIndicator type={statusType(item.status)}>{fmtStatus(item.status)}</StatusIndicator> },
        { id: 'title', header: '제목', cell: item => (
          <Box>
            <Box>{item.title || item.titleEn}</Box>
            {fmtSummary(item.summary) && <Box color="text-body-secondary" fontSize="body-s">{fmtSummary(item.summary).length > 80 ? fmtSummary(item.summary).slice(0, 80) + '…' : fmtSummary(item.summary)}</Box>}
          </Box>
        ), sortingField: 'title' },
      ]}
      empty={emptyEl}
    />
  );

  return <>
    <TopNavigation
      identity={{ href: '/', title: "AWS What's New 한국어 요약" }}
      utilities={[
        { type: 'button', iconSvg: dark
            ? <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="20" height="20"><path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z"/></svg>
            : <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="20" height="20"><circle cx="10" cy="10" r="4"/><path d="M10 1v2m0 14v2m-7-9H1m18 0h-2m-1.3-5.3l-1.4 1.4M5.7 14.3l-1.4 1.4m0-11.4l1.4 1.4m8.6 8.6l1.4 1.4"/></svg>,
          title: dark ? '라이트 모드로 전환' : '다크 모드로 전환', onClick: () => setDark(d => !d), disableUtilityCollapse: true },
        { type: 'button', text: isMobile ? 'GH' : 'GitHub', href: 'https://github.com/froguin/aws-whats-new-korean', external: true, disableUtilityCollapse: true },
      ]}
    />
    <AppLayout
      navigationHide
      toolsHide
      splitPanelOpen={splitOpen}
      onSplitPanelToggle={({ detail }) => setSplitOpen(detail.open)}
      splitPanelPreferences={{ position: isMobile ? 'bottom' : 'side' }}
      splitPanelSize={isMobile ? undefined : Math.round(window.innerWidth * 0.55)}
      splitPanel={splitPanelContent}
      content={content}
    />
    <Box textAlign="center" padding="l" color="text-body-secondary" fontSize="body-s">
      © {new Date().getFullYear()} AWS What's New 한국어 요약 · 비공식 프로젝트이며 AWS와 무관합니다. AI 자동 번역 결과가 포함되어 있습니다.
    </Box>
  </>;
}
