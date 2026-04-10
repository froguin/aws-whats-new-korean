import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AppLayout, Table, Cards, Box, SplitPanel, TokenGroup, Alert,
  SpaceBetween, Link, TextFilter, Pagination, StatusIndicator,
  TopNavigation, Button, Header,
} from '@cloudscape-design/components';
import { applyMode, Mode } from '@cloudscape-design/global-styles';

const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

interface Summary { what_changed?: string; why_it_matters?: string }
interface Article {
  id: string; title: string; titleEn: string;
  summary: string | Summary; description: string;
  target: string; features: string; regions: string;
  status: string; url: string; pubDate: string;
}

function getStatusLabel(s: string): string {
  const raw = (s || '').replace(/[\[\]"]/g, '').trim().toLowerCase();
  if (!raw || raw.includes('launched') || raw.includes('ga') || raw === 'general availability' || raw.includes('정식 출시')) return '정식 출시';
  if (raw.includes('preview') || raw.includes('미리보기')) return '미리보기';
  if (raw.includes('beta') || raw.includes('베타')) return '베타';
  if (raw.includes('retired') || raw.includes('deprecated') || raw.includes('지원 종료')) return '지원 종료';
  return raw;
}
function getStatusType(s: string): 'success' | 'info' | 'warning' | 'error' {
  const label = getStatusLabel(s);
  if (label === '미리보기') return 'info';
  if (label === '베타') return 'warning';
  if (label === '지원 종료') return 'error';
  return 'success';
}
function getSummary(s: string | Summary | null | undefined): string {
  if (!s) return '';
  if (typeof s === 'string') return s;
  return [s.what_changed, s.why_it_matters].filter(Boolean).join(' ');
}

const shortDateFmt = new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric' });
const fullDateFmt = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' });
function formatDate(d: string): string {
  if (!d) return '';
  const date = new Date(d);
  if (isNaN(date.getTime())) return '';
  return (date.getFullYear() === new Date().getFullYear() ? shortDateFmt : fullDateFmt).format(date);
}

function timeAgo(d: string): string {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '방금 전';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}일 전`;
  if (days < 30) return `${Math.floor(days / 7)}주 전`;
  if (days < 365) return `${Math.floor(days / 30)}개월 전`;
  return `${Math.floor(days / 365)}년 전`;
}

function parseRegions(r: string): { label: string }[] {
  if (!r) return [];
  return r.split(/[,;]/).map(s => s.trim()).filter(Boolean).map(label => ({ label }));
}

function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 768px)').matches);
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 768px)');
    const h = (e: MediaQueryListEvent) => setMobile(e.matches);
    mql.addEventListener('change', h);
    return () => mql.removeEventListener('change', h);
  }, []);
  return mobile;
}

export default function App() {
  const [items, setItems] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterText, setFilterText] = useState('');
  const [page, setPage] = useState(1);
  const [selectedItems, setSelectedItems] = useState<Article[]>([]);
  const [splitOpen, setSplitOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sortingColumn, setSortingColumn] = useState<{ sortingField: string }>({ sortingField: 'pubDate' });
  const [sortingDescending, setSortingDescending] = useState(true);
  const isMobile = useIsMobile();
  const pageSize = isMobile ? 15 : 30;

  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem('theme');
    return saved ? saved === 'dark' : matchMedia('(prefers-color-scheme:dark)').matches;
  });

  useEffect(() => {
    applyMode(dark ? Mode.Dark : Mode.Light);
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark]);

  // OS 다크모드 변경 반영 (사용자가 수동 설정 안 한 경우만)
  useEffect(() => {
    const mql = matchMedia('(prefers-color-scheme: dark)');
    const h = (e: MediaQueryListEvent) => {
      const saved = localStorage.getItem('theme');
      // 사용자가 토글을 한 번도 안 눌렀으면 saved가 OS 기본값과 같음
      // OS 변경 시 항상 따라감 (사용자가 원하면 토글로 다시 변경)
      setDark(e.matches);
    };
    mql.addEventListener('change', h);
    return () => mql.removeEventListener('change', h);
  }, []);

  const fetchArticles = useCallback(async (signal?: AbortSignal) => {
    if (!API_URL) { setError('API 주소가 설정되지 않았습니다.'); setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const r = await fetch(`${API_URL}/articles?limit=200`, { signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setItems(d.items || []);
    } catch (e: any) {
      if (signal?.aborted) return;
      setError(e.message?.startsWith('HTTP 5') ? '서버 오류가 발생했습니다.' :
               e.message?.startsWith('HTTP 4') ? '요청을 처리할 수 없습니다.' :
               '네트워크 연결을 확인해주세요.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchArticles(controller.signal);
    return () => controller.abort();
  }, [fetchArticles]);

  useEffect(() => {
    document.title = selectedItems[0]
      ? `${selectedItems[0].title} — AWS 새소식 한국어`
      : 'AWS 새소식 한국어';
  }, [selectedItems]);

  const filtered = useMemo(() => {
    let result = items;
    if (filterText) {
      const q = filterText.toLowerCase();
      result = result.filter(a =>
        (a.title || '').toLowerCase().includes(q) ||
        (a.titleEn || '').toLowerCase().includes(q) ||
        getSummary(a.summary).toLowerCase().includes(q)
      );
    }
    // 정렬
    const field = sortingColumn.sortingField as keyof Article;
    result = [...result].sort((a, b) => {
      const va = (a[field] || '') as string;
      const vb = (b[field] || '') as string;
      return sortingDescending ? vb.localeCompare(va) : va.localeCompare(vb);
    });
    return result;
  }, [items, filterText, sortingColumn, sortingDescending]);

  const paged = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize]);
  const detail = selectedItems[0];
  const detailRegions = useMemo(() => detail ? parseRegions(detail.regions) : [], [detail]);
  const latestDate = items[0]?.pubDate;

  const selectItem = (item: Article) => { setSelectedItems([item]); setSplitOpen(true); };
  const copyUrl = () => {
    if (detail?.url) { navigator.clipboard.writeText(detail.url); setCopied(true); setTimeout(() => setCopied(false), 2000); }
  };

  const descText = filterText
    ? `'${filterText}' 검색 결과 ${filtered.length}건`
    : `현재 ${filtered.length}개의 새 소식이 있습니다.${latestDate ? ` 최근 업데이트: ${timeAgo(latestDate)}` : ''}`;

  const splitPanelI18n = {
    preferencesTitle: '패널 설정', preferencesPositionLabel: '패널 위치',
    preferencesPositionDescription: '패널 표시 위치를 선택합니다.',
    preferencesPositionSide: '오른쪽', preferencesPositionBottom: '아래',
    preferencesConfirm: '확인', preferencesCancel: '취소',
    closeButtonAriaLabel: '상세 패널 닫기', openButtonAriaLabel: '상세 패널 열기',
    resizeHandleAriaLabel: '상세 패널 크기 조절',
  };
  const paginationAriaLabels = { nextPageLabel: '다음 페이지', previousPageLabel: '이전 페이지', pageLabel: (p: number) => `${p}페이지` };

  const splitPanel = detail ? (
    <SplitPanel header={detail.title || detail.titleEn} hidePreferencesButton closeBehavior="hide" i18nStrings={splitPanelI18n}>
      <SpaceBetween size="m">
        {detail.titleEn && detail.title !== detail.titleEn && (
          <Box color="text-body-secondary" fontSize="body-s">{detail.titleEn}</Box>
        )}
        <SpaceBetween direction="horizontal" size="xs">
          <StatusIndicator type={getStatusType(detail.status)}>{getStatusLabel(detail.status)}</StatusIndicator>
          <Box color="text-body-secondary" fontSize="body-s">{formatDate(detail.pubDate)}</Box>
        </SpaceBetween>
        <Box><Box variant="awsui-key-label">요약</Box><Box>{getSummary(detail.summary) || '요약 정보를 준비 중입니다.'}</Box></Box>
        {detail.target && <Box><Box variant="awsui-key-label">대상</Box><Box>{detail.target}</Box></Box>}
        {detail.features && <Box><Box variant="awsui-key-label">주요 기능</Box><Box>{detail.features}</Box></Box>}
        {detailRegions.length > 0 && (
          <Box><Box variant="awsui-key-label">리전</Box><TokenGroup items={detailRegions} readOnly /></Box>
        )}
        <SpaceBetween direction="horizontal" size="xs">
          <Link href={detail.url} external>AWS 원문 보기</Link>
          <Button iconName="copy" variant="inline-icon" onClick={copyUrl} ariaLabel="링크 복사">{copied ? '복사됨' : ''}</Button>
        </SpaceBetween>
      </SpaceBetween>
    </SplitPanel>
  ) : (
    <SplitPanel header="상세 정보" hidePreferencesButton closeBehavior="hide" i18nStrings={splitPanelI18n}>
      <Box textAlign="center" color="text-body-secondary" padding="l">
        목록에서 항목을 선택하면 상세 내용이 여기에 표시됩니다.
      </Box>
    </SplitPanel>
  );

  const emptyContent = error ? (
    <Box textAlign="center" padding="l">
      <Alert type="error" action={<Button onClick={() => fetchArticles()} iconName="refresh">다시 시도</Button>}>{error}</Alert>
    </Box>
  ) : filterText ? (
    <Box textAlign="center" padding="l">
      <SpaceBetween size="s">
        <Box fontWeight="bold">검색 결과가 없습니다.</Box>
        <Box color="text-body-secondary">다른 검색어를 입력하거나 필터를 지워 보세요.</Box>
        <Button onClick={() => { setFilterText(''); setPage(1); }}>필터 지우기</Button>
      </SpaceBetween>
    </Box>
  ) : (
    <Box textAlign="center" padding="l">표시할 업데이트가 없습니다.</Box>
  );

  const filterEl = (
    <TextFilter filteringText={filterText} filteringPlaceholder="제목, 서비스명으로 검색" filteringAriaLabel="업데이트 검색"
      countText={filterText ? `${filtered.length}건` : undefined}
      onChange={({ detail }) => { setFilterText(detail.filteringText); setPage(1); }} />
  );
  const paginationEl = (
    <Pagination currentPageIndex={page} pagesCount={Math.ceil(filtered.length / pageSize) || 1}
      onChange={({ detail }) => setPage(detail.currentPageIndex)} ariaLabels={paginationAriaLabels} />
  );

  const onSelectionChange = ({ detail: d }: any) => {
    setSelectedItems(d.selectedItems);
    setSplitOpen(d.selectedItems.length > 0);
  };

  const headerDesc = (
    <Box color="text-body-secondary" fontSize="body-m">
      AWS 공식 릴리스 노트를 한국어로 자동 번역·요약하여 제공합니다.{isMobile ? <br /> : ' '}{descText}
    </Box>
  );

  const mobileCards = (
    <Cards
      loading={loading} loadingText="업데이트를 불러오는 중..."
      items={paged}
      selectionType="single"
      selectedItems={selectedItems}
      onSelectionChange={onSelectionChange}
      trackBy="id"
      header={<Box padding={{ bottom: 'xs' }}>{headerDesc}</Box>}
      filter={filterEl}
      pagination={paginationEl}
      ariaLabels={{ itemSelectionLabel: (_d, item) => (item as Article).title, selectionGroupLabel: '기사 선택' }}
      cardDefinition={{
        header: item => <Box fontWeight="bold">{item.title || item.titleEn}</Box>,
        sections: [
          { id: 'meta', content: item => (
            <SpaceBetween direction="horizontal" size="xs">
              <StatusIndicator type={getStatusType(item.status)}>{getStatusLabel(item.status)}</StatusIndicator>
              <Box color="text-body-secondary" fontSize="body-s">{formatDate(item.pubDate)}</Box>
            </SpaceBetween>
          )},
        ],
      }}
      empty={emptyContent}
    />
  );

  const columnDefs = useMemo(() => [
    { id: 'pubDate', header: '날짜', width: 120, cell: (item: Article) => formatDate(item.pubDate), sortingField: 'pubDate' },
    { id: 'status', header: '상태', width: 110, cell: (item: Article) => <StatusIndicator type={getStatusType(item.status)}>{getStatusLabel(item.status)}</StatusIndicator> },
    { id: 'title', header: '제목', cell: (item: Article) => item.title || item.titleEn, sortingField: 'title' },
  ], []);

  const desktopTable = (
    <Table
      loading={loading} loadingText="업데이트를 불러오는 중..."
      items={paged} trackBy="id"
      selectionType="single" selectedItems={selectedItems}
      onSelectionChange={onSelectionChange}
      onRowClick={({ detail: d }) => selectItem(d.item)}
      sortingColumn={sortingColumn}
      sortingDescending={sortingDescending}
      onSortingChange={({ detail }) => { setSortingColumn(detail.sortingColumn as any); setSortingDescending(detail.isDescending ?? false); setPage(1); }}
      stickyHeader stripedRows variant="full-page"
      ariaLabels={{ itemSelectionLabel: (_d, item) => (item as Article).title, selectionGroupLabel: '기사 선택', tableLabel: 'AWS 릴리스 노트 목록' }}
      header={
        <Header counter={`(${filtered.length})`} description={headerDesc}>
          릴리스 노트
        </Header>
      }
      filter={filterEl}
      pagination={paginationEl}
      columnDefinitions={columnDefs}
      empty={emptyContent}
    />
  );

  return <>
    <TopNavigation
      identity={{ href: '/', title: "AWS What's New 한국어 요약" }}
      utilities={[
        {
          type: 'button',
          iconSvg: dark
            ? <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="20" height="20"><path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z"/></svg>
            : <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="20" height="20"><circle cx="10" cy="10" r="4"/><path d="M10 1v2m0 14v2m-7-9H1m18 0h-2m-1.3-5.3l-1.4 1.4M5.7 14.3l-1.4 1.4m0-11.4l1.4 1.4m8.6 8.6l1.4 1.4"/></svg>,
          title: dark ? '라이트 모드로 전환' : '다크 모드로 전환',
          onClick: () => setDark(d => !d),
          disableUtilityCollapse: true,
        },
        {
          type: 'button', text: isMobile ? 'GH' : 'GitHub',
          href: 'https://github.com/froguin/aws-whats-new-korean',
          external: true, disableUtilityCollapse: true,
        },
      ]}
    />
    <AppLayout
      navigationHide toolsHide
      splitPanelOpen={splitOpen}
      onSplitPanelToggle={({ detail }) => setSplitOpen(detail.open)}
      splitPanelPreferences={{ position: isMobile ? 'bottom' : 'side' }}
      splitPanel={splitPanel}
      content={isMobile ? mobileCards : desktopTable}
    />
    <Box textAlign="center" padding="s" color="text-body-secondary" fontSize="body-s">
      © {new Date().getFullYear()} AWS What's New 한국어 요약 · 비공식 프로젝트이며 AWS와 무관합니다. AI 자동 번역 결과가 포함되어 있습니다.
    </Box>
  </>;
}
