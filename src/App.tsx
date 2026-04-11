import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AppLayout, Table, Cards, Box, SplitPanel, Alert,
  SpaceBetween, Link, Pagination, StatusIndicator,
  TopNavigation, Button, Header, PropertyFilter, Badge,
  CollectionPreferences, ColumnLayout, KeyValuePairs, Flashbar,
  Popover, Icon, TextFilter,
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
function getWhatChanged(s: string | Summary | null | undefined): string {
  if (!s) return '';
  if (typeof s === 'string') return s;
  return s.what_changed || '';
}
function getWhyItMatters(s: string | Summary | null | undefined): string {
  if (!s) return '';
  if (typeof s === 'string') return '';
  return s.why_it_matters || '';
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
function parseRegions(r: string): string[] {
  if (!r) return [];
  return r.split(/[,;]/).map(s => s.trim()).filter(Boolean);
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

// ── PropertyFilter definitions ──
const FILTERING_PROPERTIES = [
  { key: 'status', propertyLabel: '상태', groupValuesLabel: '상태 값', operators: ['=', '!='] as const },
  { key: 'target', propertyLabel: '대상', groupValuesLabel: '대상 값', operators: ['=', '!=', ':'] as const },
  { key: 'regions', propertyLabel: '리전', groupValuesLabel: '리전 값', operators: ['=', ':'] as const },
  { key: 'title', propertyLabel: '제목', groupValuesLabel: '제목 값', operators: [':'] as const },
];

const COLUMN_DEFS = [
  {
    id: 'status', header: '상태', width: 120, sortingField: 'status',
    cell: (item: Article) => <StatusIndicator type={getStatusType(item.status)}>{getStatusLabel(item.status)}</StatusIndicator>,
  },
  {
    id: 'pubDate', header: '날짜', width: 150, sortingField: 'pubDate',
    cell: (item: Article) => (
      <SpaceBetween direction="vertical" size="xxxs">
        <Box>{formatDate(item.pubDate)}</Box>
        <Box fontSize="body-s" color="text-body-secondary">{timeAgo(item.pubDate)}</Box>
      </SpaceBetween>
    ),
  },
  {
    id: 'title', header: '제목', sortingField: 'title',
    cell: (item: Article) => (
      <SpaceBetween direction="vertical" size="xxxs">
        <Box fontWeight="bold">{item.title || item.titleEn}</Box>
        {item.titleEn && item.title !== item.titleEn && (
          <Box fontSize="body-s" color="text-body-secondary">{item.titleEn}</Box>
        )}
      </SpaceBetween>
    ),
  },
  {
    id: 'target', header: '대상', width: 160,
    cell: (item: Article) => item.target ? <Box fontSize="body-s">{item.target}</Box> : <Box>-</Box>,
  },
  {
    id: 'regions', header: '리전', width: 200,
    cell: (item: Article) => {
      const regions = parseRegions(item.regions);
      if (regions.length === 0) return <Box>-</Box>;
      if (regions.length <= 2) return <Box fontSize="body-s" color="text-body-secondary">{regions.join(', ')}</Box>;
      return (
        <Popover
          dismissButton={false} position="top" size="medium"
          triggerType="text"
          content={<Box>{regions.join(', ')}</Box>}
        >
          <Box fontSize="body-s" color="text-body-secondary">{regions.slice(0, 2).join(', ')} <Badge>+{regions.length - 2}</Badge></Box>
        </Popover>
      );
    },
  },
  {
    id: 'features', header: '주요 기능', width: 220,
    cell: (item: Article) => <Box fontSize="body-s" color="text-body-secondary">{item.features || '-'}</Box>,
  },
  {
    id: 'titleEn', header: '영문 제목', width: 280,
    cell: (item: Article) => <Box fontSize="body-s" color="text-body-secondary">{item.titleEn || '-'}</Box>,
  },
];

const DEFAULT_VISIBLE = ['status', 'pubDate', 'title', 'regions'];
const PAGE_SIZE_OPTIONS = [
  { value: 10, label: '10개' },
  { value: 25, label: '25개' },
  { value: 50, label: '50개' },
  { value: 100, label: '100개' },
];

export default function App() {
  const [items, setItems] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [selectedItems, setSelectedItems] = useState<Article[]>([]);
  const [splitOpen, setSplitOpen] = useState(false);
  const [sortingColumn, setSortingColumn] = useState<{ sortingField: string }>({ sortingField: 'pubDate' });
  const [sortingDescending, setSortingDescending] = useState(true);
  const [flashItems, setFlashItems] = useState<any[]>([]);
  const isMobile = useIsMobile();

  // PropertyFilter state
  const [query, setQuery] = useState<any>({ tokens: [], operation: 'and' });
  // CollectionPreferences state
  const [preferences, setPreferences] = useState({
    pageSize: 10,
    visibleContent: DEFAULT_VISIBLE,
    wrapLines: false,
    stripedRows: true,
  });
  const pageSize = isMobile ? 15 : preferences.pageSize;

  // Mobile filter text (simple)
  const [filterText, setFilterText] = useState('');

  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem('theme');
    return saved ? saved === 'dark' : matchMedia('(prefers-color-scheme:dark)').matches;
  });

  useEffect(() => {
    applyMode(dark ? Mode.Dark : Mode.Light);
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark]);

  useEffect(() => {
    const mql = matchMedia('(prefers-color-scheme: dark)');
    const h = (e: MediaQueryListEvent) => setDark(e.matches);
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
      setFlashItems([{ type: 'success', content: `${(d.items || []).length}개의 릴리스 노트를 불러왔습니다.`, dismissible: true, dismissLabel: '닫기', onDismiss: () => setFlashItems([]), id: 'load-success' }]);
    } catch (e: any) {
      if (signal?.aborted) return;
      const msg = e.message?.startsWith('HTTP 5') ? '서버 오류가 발생했습니다.' :
                  e.message?.startsWith('HTTP 4') ? '요청을 처리할 수 없습니다.' :
                  '네트워크 연결을 확인해주세요.';
      setError(msg);
      setFlashItems([{ type: 'error', content: msg, dismissible: true, dismissLabel: '닫기', onDismiss: () => setFlashItems([]), id: 'load-error' }]);
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
      ? `${selectedItems[0].title} — AWS What's New 한국어 요약`
      : "AWS What's New 한국어 요약";
  }, [selectedItems]);

  // ── Filtering ──
  const filtered = useMemo(() => {
    let result = items;

    if (isMobile) {
      // Mobile: simple text filter
      if (filterText) {
        const q = filterText.toLowerCase();
        result = result.filter(a =>
          (a.title || '').toLowerCase().includes(q) ||
          (a.titleEn || '').toLowerCase().includes(q) ||
          getSummary(a.summary).toLowerCase().includes(q)
        );
      }
    } else {
      // PC: PropertyFilter
      if (query.tokens.length > 0) {
        result = result.filter(item => {
          const checks = query.tokens.map((token: any) => {
            let value = '';
            if (token.propertyKey === 'status') value = getStatusLabel(item.status);
            else if (token.propertyKey === 'target') value = item.target || '';
            else if (token.propertyKey === 'regions') value = item.regions || '';
            else if (token.propertyKey === 'title') value = `${item.title} ${item.titleEn}`;
            else return true;

            const v = value.toLowerCase();
            const t = (token.value || '').toLowerCase();
            if (token.operator === '=') return v === t;
            if (token.operator === '!=') return v !== t;
            if (token.operator === ':') return v.includes(t);
            return true;
          });
          return query.operation === 'and' ? checks.every(Boolean) : checks.some(Boolean);
        });
      }
    }

    // Sort
    const field = sortingColumn.sortingField as keyof Article;
    result = [...result].sort((a, b) => {
      let va = '', vb = '';
      if (field === 'status') { va = getStatusLabel(a.status); vb = getStatusLabel(b.status); }
      else { va = (a[field] || '') as string; vb = (b[field] || '') as string; }
      return sortingDescending ? vb.localeCompare(va) : va.localeCompare(vb);
    });
    return result;
  }, [items, query, filterText, isMobile, sortingColumn, sortingDescending]);

  const paged = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize]);
  const detail = selectedItems[0];
  const latestDate = items[0]?.pubDate;

  // ── Unique values for PropertyFilter ──
  const filteringOptions = useMemo(() => {
    const statuses = [...new Set(items.map(i => getStatusLabel(i.status)))].sort();
    const targets = [...new Set(items.map(i => i.target).filter(Boolean))].sort();
    const regions = [...new Set(items.flatMap(i => parseRegions(i.regions)))].sort();
    return [
      ...statuses.map(v => ({ propertyKey: 'status', value: v })),
      ...targets.map(v => ({ propertyKey: 'target', value: v })),
      ...regions.map(v => ({ propertyKey: 'regions', value: v })),
    ];
  }, [items]);

  const selectItem = (item: Article) => { setSelectedItems([item]); setSplitOpen(true); };
  const onSelectionChange = ({ detail: d }: any) => {
    setSelectedItems(d.selectedItems);
    setSplitOpen(d.selectedItems.length > 0);
  };

  // ── i18n ──
  const splitPanelI18n = {
    preferencesTitle: '패널 설정', preferencesPositionLabel: '패널 위치',
    preferencesPositionDescription: '패널 표시 위치를 선택합니다.',
    preferencesPositionSide: '오른쪽', preferencesPositionBottom: '아래',
    preferencesConfirm: '확인', preferencesCancel: '취소',
    closeButtonAriaLabel: '상세 패널 닫기', openButtonAriaLabel: '상세 패널 열기',
    resizeHandleAriaLabel: '상세 패널 크기 조절',
  };
  const paginationAriaLabels = { nextPageLabel: '다음 페이지', previousPageLabel: '이전 페이지', pageLabel: (p: number) => `${p}페이지` };

  // ── SplitPanel detail ──
  const detailRegions = useMemo(() => detail ? parseRegions(detail.regions) : [], [detail]);
  const splitPanel = detail ? (
    <SplitPanel header={detail.title || detail.titleEn} hidePreferencesButton closeBehavior="hide" i18nStrings={splitPanelI18n}>
      <ColumnLayout columns={2} variant="text-grid">
        <SpaceBetween size="m">
          <KeyValuePairs
            columns={2}
            items={[
              { label: '상태', value: <StatusIndicator type={getStatusType(detail.status)}>{getStatusLabel(detail.status)}</StatusIndicator> },
              { label: '날짜', value: <Box>{formatDate(detail.pubDate)} <Box display="inline-block" color="text-body-secondary" fontSize="body-s">({timeAgo(detail.pubDate)})</Box></Box> },
              ...(detail.target ? [{ label: '대상', value: detail.target }] : []),
              ...(detailRegions.length > 0 ? [{ label: '리전', value: <Box fontSize="body-s">{detailRegions.join(', ')}</Box> }] : []),
            ]}
          />
          {detail.titleEn && detail.title !== detail.titleEn && (
            <Box color="text-body-secondary" fontSize="body-s">{detail.titleEn}</Box>
          )}
          <Link href={detail.url} external>AWS 원문 보기</Link>
        </SpaceBetween>
        <SpaceBetween size="m">
          {getWhatChanged(detail.summary) && (
            <Box><Box variant="awsui-key-label">변경 사항</Box><Box>{getWhatChanged(detail.summary)}</Box></Box>
          )}
          {getWhyItMatters(detail.summary) && (
            <Box><Box variant="awsui-key-label">중요한 이유</Box><Box>{getWhyItMatters(detail.summary)}</Box></Box>
          )}
          {!getWhatChanged(detail.summary) && !getWhyItMatters(detail.summary) && getSummary(detail.summary) && (
            <Box><Box variant="awsui-key-label">요약</Box><Box>{getSummary(detail.summary)}</Box></Box>
          )}
          {detail.features && (
            <Box><Box variant="awsui-key-label">주요 기능</Box><Box>{detail.features}</Box></Box>
          )}
        </SpaceBetween>
      </ColumnLayout>
    </SplitPanel>
  ) : (
    <SplitPanel header="상세 정보" hidePreferencesButton closeBehavior="hide" i18nStrings={splitPanelI18n}>
      <Box textAlign="center" color="text-body-secondary" padding="l">
        목록에서 항목을 선택하면 상세 내용이 여기에 표시됩니다.
      </Box>
    </SplitPanel>
  );

  // ── Empty state ──
  const hasFilter = isMobile ? !!filterText : query.tokens.length > 0;
  const clearFilter = () => { if (isMobile) { setFilterText(''); } else { setQuery({ tokens: [], operation: 'and' }); } setPage(1); };
  const emptyContent = error ? (
    <Box textAlign="center" padding="l">
      <Alert type="error" action={<Button onClick={() => fetchArticles()} iconName="refresh">다시 시도</Button>}>{error}</Alert>
    </Box>
  ) : hasFilter ? (
    <Box textAlign="center" padding="l">
      <SpaceBetween size="s">
        <Box fontWeight="bold">검색 결과가 없습니다.</Box>
        <Box color="text-body-secondary">다른 검색어를 입력하거나 필터를 지워 보세요.</Box>
        <Button onClick={clearFilter}>필터 지우기</Button>
      </SpaceBetween>
    </Box>
  ) : (
    <Box textAlign="center" padding="l">표시할 업데이트가 없습니다.</Box>
  );

  const paginationEl = (
    <Pagination currentPageIndex={page} pagesCount={Math.ceil(filtered.length / pageSize) || 1}
      onChange={({ detail }) => setPage(detail.currentPageIndex)} ariaLabels={paginationAriaLabels} />
  );

  const descText = hasFilter
    ? `필터 결과 ${filtered.length}건 / 전체 ${items.length}건`
    : `전체 ${items.length}개${latestDate ? ` · 최근 업데이트: ${timeAgo(latestDate)}` : ''}`;

  const headerEl = (
    <Header
      counter={hasFilter ? `(${filtered.length}/${items.length})` : `(${items.length})`}
      description="AWS 공식 릴리스 노트를 한국어로 자동 번역·요약하여 제공합니다."
      actions={
        <SpaceBetween direction="horizontal" size="xs">
          {detail && <Button href={detail.url} iconName="external" target="_blank" variant="normal">원문 보기</Button>}
          <Button iconName="refresh" onClick={() => fetchArticles()} loading={loading}>새로고침</Button>
        </SpaceBetween>
      }
    >
      릴리스 노트
    </Header>
  );

  // ── Visible columns ──
  const visibleColumns = useMemo(
    () => COLUMN_DEFS.filter(c => preferences.visibleContent.includes(c.id)),
    [preferences.visibleContent]
  );

  // ── Mobile detail (full screen) ──
  const mobileDetail = detail ? (
    <SpaceBetween size="l">
      <Button iconName="arrow-left" variant="link" onClick={() => { setSelectedItems([]); }}>목록으로</Button>
      <SpaceBetween size="m">
        <Box variant="h2">{detail.title || detail.titleEn}</Box>
        {detail.titleEn && detail.title !== detail.titleEn && (
          <Box color="text-body-secondary" fontSize="body-s">{detail.titleEn}</Box>
        )}
        <SpaceBetween direction="horizontal" size="xs">
          <StatusIndicator type={getStatusType(detail.status)}>{getStatusLabel(detail.status)}</StatusIndicator>
          <Box color="text-body-secondary" fontSize="body-s">{formatDate(detail.pubDate)} ({timeAgo(detail.pubDate)})</Box>
        </SpaceBetween>
        {getWhatChanged(detail.summary) && (
          <Box><Box variant="awsui-key-label">변경 사항</Box><Box>{getWhatChanged(detail.summary)}</Box></Box>
        )}
        {getWhyItMatters(detail.summary) && (
          <Box><Box variant="awsui-key-label">중요한 이유</Box><Box>{getWhyItMatters(detail.summary)}</Box></Box>
        )}
        {!getWhatChanged(detail.summary) && !getWhyItMatters(detail.summary) && getSummary(detail.summary) && (
          <Box><Box variant="awsui-key-label">요약</Box><Box>{getSummary(detail.summary)}</Box></Box>
        )}
        {detail.target && <Box><Box variant="awsui-key-label">대상</Box><Box>{detail.target}</Box></Box>}
        {detail.features && <Box><Box variant="awsui-key-label">주요 기능</Box><Box>{detail.features}</Box></Box>}
        {detailRegions.length > 0 && <Box><Box variant="awsui-key-label">리전</Box><Box fontSize="body-s">{detailRegions.join(', ')}</Box></Box>}
        <Link href={detail.url} external>AWS 원문 보기</Link>
      </SpaceBetween>
    </SpaceBetween>
  ) : null;

  // ── Mobile Cards ──
  const mobileCards = (
    <Cards
      loading={loading} loadingText="업데이트를 불러오는 중..."
      items={paged} trackBy="id"
      header={headerEl}
      filter={
        <TextFilter
          filteringText={filterText}
          filteringPlaceholder="제목, 서비스명으로 검색"
          filteringAriaLabel="업데이트 검색"
          onChange={({ detail }) => { setFilterText(detail.filteringText); setPage(1); }}
        />
      }
      pagination={paginationEl}
      ariaLabels={{ itemSelectionLabel: (_d, item) => (item as Article).title, selectionGroupLabel: '기사 선택' }}
      cardDefinition={{
        header: item => <div onClick={() => selectItem(item)} style={{ cursor: 'pointer' }}><Box fontWeight="bold">{item.title || item.titleEn}</Box></div>,
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

  // ── PC Table ──
  const desktopTable = (
    <Table
      loading={loading} loadingText="업데이트를 불러오는 중..."
      items={paged} trackBy="id"
      selectionType="single" selectedItems={selectedItems}
      onSelectionChange={onSelectionChange}
      onRowClick={({ detail: d }) => selectItem(d.item)}
      sortingColumn={sortingColumn} sortingDescending={sortingDescending}
      onSortingChange={({ detail }) => { setSortingColumn(detail.sortingColumn as any); setSortingDescending(detail.isDescending ?? false); setPage(1); }}
      stickyHeader stripedRows={preferences.stripedRows} wrapLines={preferences.wrapLines}
      variant="full-page"
      ariaLabels={{ itemSelectionLabel: (_d, item) => (item as Article).title, selectionGroupLabel: '기사 선택', tableLabel: 'AWS 릴리스 노트 목록' }}
      header={headerEl}
      filter={
        <PropertyFilter
          query={query}
          onChange={({ detail }) => { setQuery(detail); setPage(1); }}
          filteringProperties={FILTERING_PROPERTIES}
          filteringOptions={filteringOptions}
          filteringPlaceholder="상태, 대상, 리전으로 필터링"
          filteringAriaLabel="릴리스 노트 필터"
          i18nStrings={{
            filteringAriaLabel: '릴리스 노트 필터',
            filteringPlaceholder: '상태, 대상, 리전으로 필터링',
            groupValuesText: '값',
            groupPropertiesText: '속성',
            operatorsText: '연산자',
            operationAndText: '그리고',
            operationOrText: '또는',
            operatorLessText: '미만',
            operatorLessOrEqualText: '이하',
            operatorGreaterText: '초과',
            operatorGreaterOrEqualText: '이상',
            operatorContainsText: '포함',
            operatorDoesNotContainText: '미포함',
            operatorEqualsText: '같음',
            operatorDoesNotEqualText: '다름',
            editTokenHeader: '필터 편집',
            propertyText: '속성',
            operatorText: '연산자',
            valueText: '값',
            cancelActionText: '취소',
            applyActionText: '적용',
            clearFiltersText: '필터 지우기',
            removeTokenButtonAriaLabel: (token) => `${token.propertyLabel} ${token.operator} ${token.value} 제거`,
            enteredTextLabel: (text) => `"${text}" 사용`,
          }}
        />
      }
      pagination={paginationEl}
      preferences={
        <CollectionPreferences
          title="환경 설정"
          confirmLabel="확인"
          cancelLabel="취소"
          preferences={preferences}
          onConfirm={({ detail }) => setPreferences(detail as any)}
          pageSizePreference={{ title: '페이지 크기', options: PAGE_SIZE_OPTIONS }}
          visibleContentPreference={{
            title: '표시 컬럼',
            options: [{ label: '컬럼', options: COLUMN_DEFS.map(c => ({ id: c.id, label: c.header, editable: c.id !== 'title' })) }],
          }}
          wrapLinesPreference={{ label: '줄 바꿈', description: '긴 텍스트를 줄 바꿈하여 표시합니다.' }}
          stripedRowsPreference={{ label: '줄무늬 행', description: '행을 번갈아 음영 처리합니다.' }}
        />
      }
      columnDefinitions={visibleColumns}
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
        ...(!isMobile ? [{
          type: 'button' as const, text: 'GitHub',
          href: 'https://github.com/froguin/aws-whats-new-korean',
          external: true, disableUtilityCollapse: true,
        }] : []),
      ]}
    />
    <AppLayout
      navigationHide toolsHide
      splitPanelOpen={!isMobile && splitOpen}
      onSplitPanelToggle={({ detail }) => setSplitOpen(detail.open)}
      splitPanelPreferences={{ position: 'bottom' }}
      splitPanel={!isMobile ? splitPanel : undefined}
      notifications={<Flashbar items={flashItems} />}
      content={isMobile ? (detail ? mobileDetail : mobileCards) : desktopTable}
    />
    <Box textAlign="center" padding="s" color="text-body-secondary" fontSize="body-s">
      © {new Date().getFullYear()} AWS What's New 한국어 요약 · 비공식 프로젝트이며 AWS와 무관합니다. AI 자동 번역 결과가 포함되어 있습니다.
    </Box>
  </>;
}
