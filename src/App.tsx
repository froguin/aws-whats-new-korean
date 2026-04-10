import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AppLayout, Table, Box, SplitPanel, TokenGroup, Alert,
  SpaceBetween, Link, TextFilter, Pagination, StatusIndicator,
  TopNavigation, Button, Header,
} from '@cloudscape-design/components';
import { applyMode, Mode } from '@cloudscape-design/global-styles';

const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

interface Article {
  id: string; title: string; titleEn: string;
  summary: string; description: string;
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

function getSummary(s: any): string {
  if (!s) return '';
  if (typeof s === 'string') return s;
  return [s.what_changed, s.why_it_matters].filter(Boolean).join(' ');
}

function formatDate(d: string): string {
  if (!d) return '';
  const date = new Date(d);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString('ko-KR', sameYear ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' });
}

function timeAgo(d: string): string {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '방금 전';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

function parseRegions(r: string): { label: string }[] {
  if (!r) return [];
  return r.split(/[,;]/).map(s => s.trim()).filter(Boolean).map(label => ({ label }));
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
  const [filterText, setFilterText] = useState('');
  const [page, setPage] = useState(1);
  const [selectedItems, setSelectedItems] = useState<Article[]>([]);
  const [splitOpen, setSplitOpen] = useState(false);
  const isMobile = useIsMobile();
  const pageSize = isMobile ? 15 : 30;

  const [dark, setDark] = useState(() => {
    const s = localStorage.getItem('theme');
    return s ? s === 'dark' : matchMedia('(prefers-color-scheme:dark)').matches;
  });

  useEffect(() => {
    applyMode(dark ? Mode.Dark : Mode.Light);
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark]);

  const fetchArticles = useCallback(() => {
    if (!API_URL) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    fetch(`${API_URL}/articles?limit=200`)
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then(d => { setItems(d.items || []); setLoading(false); })
      .catch(() => { setError('업데이트를 불러오지 못했습니다.'); setLoading(false); });
  }, []);

  useEffect(() => { fetchArticles(); }, [fetchArticles]);

  const filtered = useMemo(() => {
    if (!filterText) return items;
    const q = filterText.toLowerCase();
    return items.filter(a =>
      (a.title || '').toLowerCase().includes(q) ||
      (a.titleEn || '').toLowerCase().includes(q) ||
      getSummary(a.summary).toLowerCase().includes(q)
    );
  }, [items, filterText]);

  const paged = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize]);
  const detail = selectedItems[0];
  const latestDate = items[0]?.pubDate;

  const selectItem = (item: Article) => {
    setSelectedItems([item]);
    setSplitOpen(true);
  };

  const descText = filterText
    ? `'${filterText}' 검색 결과 ${filtered.length}건`
    : `현재 ${filtered.length}개의 새 소식이 있습니다.${latestDate ? ` 최근 업데이트: ${timeAgo(latestDate)}` : ''}`;

  const splitPanelI18n = {
    preferencesTitle: '위치 설정', preferencesPositionLabel: '위치',
    preferencesPositionDescription: '패널 표시 위치를 선택합니다.',
    preferencesPositionSide: '오른쪽', preferencesPositionBottom: '아래쪽',
    preferencesConfirm: '확인', preferencesCancel: '취소',
    closeButtonAriaLabel: '상세 패널 닫기', openButtonAriaLabel: '상세 패널 열기',
    resizeHandleAriaLabel: '패널 크기 조절',
  };

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
        {parseRegions(detail.regions).length > 0 && (
          <Box><Box variant="awsui-key-label">리전</Box><TokenGroup items={parseRegions(detail.regions)} readOnly /></Box>
        )}
        <Link href={detail.url} external>AWS 원문 보기</Link>
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
      <SpaceBetween size="s">
        <Alert type="error">{error}</Alert>
        <Button onClick={fetchArticles}>다시 시도</Button>
      </SpaceBetween>
    </Box>
  ) : filterText ? (
    <Box textAlign="center" padding="l">
      <SpaceBetween size="xs">
        <Box fontWeight="bold">검색 결과가 없습니다.</Box>
        <Box color="text-body-secondary">다른 검색어를 입력하거나 필터를 지워 보세요.</Box>
      </SpaceBetween>
    </Box>
  ) : (
    <Box textAlign="center" padding="l">표시할 업데이트가 없습니다.</Box>
  );

  const mobileList = (
    <SpaceBetween size="s">
      <Box padding={{ bottom: 'xs' }}>
        <Box color="text-body-secondary" fontSize="body-m">
          AWS 공식 릴리스 노트를 한국어로 자동 번역·요약하여 제공합니다.<br />{descText}
        </Box>
      </Box>
      <TextFilter filteringText={filterText} filteringPlaceholder="제목, 서비스명으로 검색" filteringAriaLabel="업데이트 검색"
        countText={filterText ? `${filtered.length}건` : undefined}
        onChange={({ detail }) => { setFilterText(detail.filteringText); setPage(1); }} />
      {loading ? (
        <Box textAlign="center" padding="l">업데이트를 불러오는 중...</Box>
      ) : error ? emptyContent : paged.length === 0 ? emptyContent : (
        <div role="list" aria-label="릴리스 노트 목록">
          {paged.map(item => (
            <div key={item.id} role="listitem" tabIndex={0}
              onClick={() => selectItem(item)}
              onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && selectItem(item)}
              style={{
                padding: '12px 16px', cursor: 'pointer', userSelect: 'none',
                borderBottom: '1px solid var(--color-border-divider-default, #e9ebed)',
                borderLeft: detail?.id === item.id ? '3px solid var(--color-border-item-focused, #0972d3)' : '3px solid transparent',
                backgroundColor: detail?.id === item.id ? 'var(--color-background-item-selected, #f2f8fd)' : 'transparent',
                transition: 'background-color 0.15s',
              }}>
              <SpaceBetween size="xxs">
                <Box fontWeight="bold">{item.title || item.titleEn}</Box>
                <SpaceBetween direction="horizontal" size="xs">
                  <StatusIndicator type={getStatusType(item.status)}>{getStatusLabel(item.status)}</StatusIndicator>
                  <Box color="text-body-secondary" fontSize="body-s">{formatDate(item.pubDate)}</Box>
                </SpaceBetween>
              </SpaceBetween>
            </div>
          ))}
        </div>
      )}
      <Pagination currentPageIndex={page} pagesCount={Math.ceil(filtered.length / pageSize) || 1}
        onChange={({ detail }) => setPage(detail.currentPageIndex)}
        ariaLabels={{ nextPageLabel: '다음 페이지', previousPageLabel: '이전 페이지', pageLabel: p => `${p}페이지` }} />
    </SpaceBetween>
  );

  const desktopTable = (
    <Table
      loading={loading} loadingText="업데이트를 불러오는 중..."
      items={paged}
      selectionType="single"
      selectedItems={selectedItems}
      onSelectionChange={({ detail }) => { setSelectedItems(detail.selectedItems); setSplitOpen(detail.selectedItems.length > 0); }}
      onRowClick={({ detail: d }) => selectItem(d.item)}
      stickyHeader
      stripedRows
      variant="full-page"
      ariaLabels={{ itemSelectionLabel: (_d, item) => (item as Article).title, selectionGroupLabel: '기사 선택', tableLabel: 'AWS 릴리스 노트 목록' }}
      header={
        <Header counter={`(${filtered.length})`}>
          <Box color="text-body-secondary" fontSize="body-m">
            AWS 공식 릴리스 노트를 한국어로 자동 번역·요약하여 제공합니다. {descText}
          </Box>
        </Header>
      }
      filter={
        <TextFilter filteringText={filterText} filteringPlaceholder="제목, 서비스명으로 검색" filteringAriaLabel="업데이트 검색"
          countText={filterText ? `${filtered.length}건` : undefined}
          onChange={({ detail }) => { setFilterText(detail.filteringText); setPage(1); }} />
      }
      pagination={
        <Pagination currentPageIndex={page} pagesCount={Math.ceil(filtered.length / pageSize) || 1}
          onChange={({ detail }) => setPage(detail.currentPageIndex)}
          ariaLabels={{ nextPageLabel: '다음 페이지', previousPageLabel: '이전 페이지', pageLabel: p => `${p}페이지` }} />
      }
      columnDefinitions={[
        { id: 'pubDate', header: '날짜', width: 120, cell: item => formatDate(item.pubDate), sortingField: 'pubDate' },
        { id: 'status', header: '상태', width: 110, cell: item => <StatusIndicator type={getStatusType(item.status)}>{getStatusLabel(item.status)}</StatusIndicator> },
        { id: 'title', header: '제목', cell: item => item.title || item.titleEn, sortingField: 'title' },
      ]}
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
          type: 'button',
          text: isMobile ? 'GH' : 'GitHub',
          href: 'https://github.com/froguin/aws-whats-new-korean',
          external: true,
          disableUtilityCollapse: true,
        },
      ]}
    />
    <AppLayout
      navigationHide
      toolsHide
      splitPanelOpen={splitOpen}
      onSplitPanelToggle={({ detail }) => setSplitOpen(detail.open)}
      splitPanelPreferences={{ position: isMobile ? 'bottom' : 'side' }}
      splitPanelSize={isMobile ? undefined : Math.round(window.innerWidth * 0.5)}
      splitPanel={splitPanel}
      content={isMobile ? mobileList : desktopTable}
    />
    <Box textAlign="center" padding="s" color="text-body-secondary" fontSize="body-s">
      © {new Date().getFullYear()} AWS What's New 한국어 요약 · 비공식 프로젝트이며 AWS와 무관합니다. AI 자동 번역 결과가 포함되어 있습니다.
    </Box>
  </>;
}
