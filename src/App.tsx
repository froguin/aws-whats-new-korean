import React, { useEffect, useState } from 'react';
import {
  AppLayout, ContentLayout, Header, Cards, Box, Badge,
  SpaceBetween, Link, TextFilter, Pagination, StatusIndicator,
  TopNavigation,
} from '@cloudscape-design/components';
import { applyMode, Mode } from '@cloudscape-design/global-styles';
import './fonts.css';

const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

interface Article {
  id: string;
  title: string;
  titleEn: string;
  summary: string | { what_changed?: string; why_it_matters?: string };
  target: string;
  features: string | string[];
  regions: string;
  status: string;
  url: string;
  pubDate: string;
}

function formatSummary(summary: Article['summary']): string {
  if (typeof summary === 'string') return summary;
  return [summary.what_changed, summary.why_it_matters].filter(Boolean).join(' ');
}

function formatStatus(status: string): string {
  try { return status.replace(/[\[\]"]/g, '').trim(); } catch { return status; }
}

function statusType(status: string): 'success' | 'info' | 'warning' | 'error' {
  const s = formatStatus(status);
  if (s.includes('정식 출시')) return 'success';
  if (s.includes('미리보기')) return 'info';
  if (s.includes('베타')) return 'warning';
  if (s.includes('지원 종료')) return 'error';
  return 'info';
}

export default function App() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterText, setFilterText] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 12;
  const [isDark, setIsDark] = useState(() => localStorage.getItem('theme') === 'dark');

  useEffect(() => {
    applyMode(isDark ? Mode.Dark : Mode.Light);
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  useEffect(() => {
    if (!API_URL) { setLoading(false); return; }
    fetch(`${API_URL}/articles?limit=200`)
      .then(r => r.json())
      .then(d => { setArticles(d.items || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const filtered = articles.filter(a => {
    if (!filterText) return true;
    const q = filterText.toLowerCase();
    return a.title?.toLowerCase().includes(q)
      || a.titleEn?.toLowerCase().includes(q)
      || formatSummary(a.summary).toLowerCase().includes(q);
  });

  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  return (
    <>
      <TopNavigation
        identity={{ href: '/', title: 'AWS What\'s New 한국어 요약' }}
        utilities={[
          { type: 'button', text: isDark ? '라이트 모드' : '다크 모드', onClick: () => setIsDark(d => !d) },
          { type: 'button', text: 'GitHub', href: 'https://github.com/froguin/aws-whats-new-korean', external: true },
        ]}
      />
      <AppLayout
        navigationHide
        toolsHide
        content={
          <ContentLayout
            header={
              <Header
                variant="h1"
                description="AWS 공식 릴리스 노트를 한국어로 자동 번역·검수하여 보여줍니다."
                counter={`(${filtered.length})`}
              >
                AWS What's New 한국어 요약
              </Header>
            }
          >
            <Cards
              loading={loading}
              loadingText="업데이트를 불러오는 중..."
              items={paged}
              filter={
                <TextFilter
                  filteringText={filterText}
                  filteringPlaceholder="키워드로 검색"
                  onChange={({ detail }) => { setFilterText(detail.filteringText); setPage(1); }}
                />
              }
              pagination={
                <Pagination
                  currentPageIndex={page}
                  pagesCount={Math.ceil(filtered.length / pageSize)}
                  onChange={({ detail }) => setPage(detail.currentPageIndex)}
                />
              }
              cardDefinition={{
                header: item => (
                  <Link href={item.url} external fontSize="heading-m">
                    {item.title || item.titleEn}
                  </Link>
                ),
                sections: [
                  {
                    id: 'status',
                    header: '상태',
                    content: item => (
                      <SpaceBetween direction="horizontal" size="xs">
                        <StatusIndicator type={statusType(item.status)}>
                          {formatStatus(item.status) || '정식 출시'}
                        </StatusIndicator>
                        <Box color="text-body-secondary" fontSize="body-s">
                          {item.pubDate ? new Date(item.pubDate).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' }) : ''}
                        </Box>
                      </SpaceBetween>
                    ),
                  },
                  {
                    id: 'summary',
                    header: '요약',
                    content: item => (
                      <Box color="text-body-secondary">{formatSummary(item.summary)}</Box>
                    ),
                  },
                  {
                    id: 'features',
                    header: '주요 기능',
                    content: item => {
                      const f = Array.isArray(item.features) ? item.features.join(', ') : item.features;
                      return f ? <Box color="text-body-secondary" fontSize="body-s">{f}</Box> : null;
                    },
                  },
                  {
                    id: 'regions',
                    header: '리전',
                    content: item => item.regions ? (
                      <Box color="text-body-secondary" fontSize="body-s">{item.regions}</Box>
                    ) : null,
                  },
                ],
              }}
              empty={
                <Box textAlign="center" color="inherit" padding="l">
                  {API_URL ? '표시할 업데이트가 없습니다.' : 'API URL이 설정되지 않았습니다.'}
                </Box>
              }
            />
          </ContentLayout>
        }
      />
      <Box textAlign="center" padding="l" color="text-body-secondary" fontSize="body-s">
        © {new Date().getFullYear()} AWS What's New 한국어 요약. This is not an official AWS product or project.
      </Box>
    </>
  );
}
