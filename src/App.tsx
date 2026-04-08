import React, { useEffect, useState } from 'react';
import {
  AppLayout, ContentLayout, Header, Cards, Box,
  SpaceBetween, Link, TextFilter, Pagination, StatusIndicator,
  TopNavigation,
} from '@cloudscape-design/components';
import { applyMode, Mode } from '@cloudscape-design/global-styles';

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
  let s = '';
  if (typeof summary === 'string') s = summary;
  else s = [summary?.what_changed, summary?.why_it_matters].filter(Boolean).join(' ');
  return s.length > 120 ? s.slice(0, 120) + '…' : s;
}

function formatStatus(status: string): string {
  try { return status.replace(/[\[\]"]/g, '').trim(); } catch { return status; }
}

function inferStatus(item: Article): { type: 'success' | 'info' | 'warning' | 'error'; label: string } {
  // 1. LLM이 번역한 status 값 우선 사용
  const stored = formatStatus(item.status || '');
  if (stored.includes('정식 출시')) return { type: 'success', label: '정식 출시' };
  if (stored.includes('미리보기')) return { type: 'info', label: '미리보기' };
  if (stored.includes('베타')) return { type: 'warning', label: '베타' };
  if (stored.includes('지원 종료')) return { type: 'error', label: '지원 종료' };

  // 2. 원문 영어 제목에서 status 키워드 추출
  const en = (item.titleEn || '').toLowerCase();
  if (/\bpreview\b/.test(en)) return { type: 'info', label: '미리보기' };
  if (/\bbeta\b/.test(en)) return { type: 'warning', label: '베타' };
  if (/retired|end of support|deprecat/.test(en)) return { type: 'error', label: '지원 종료' };
  if (/generally available|now available|launched|\bga\b/.test(en)) return { type: 'success', label: '정식 출시' };

  // 3. 기본값
  return { type: 'success', label: '정식 출시' };
}

const MoonIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 20 20" width="20" height="20">
    <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z"/>
  </svg>
);

const SunIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 20 20" width="20" height="20">
    <path d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z"/>
  </svg>
);

export default function App() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterText, setFilterText] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 12;
  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem('theme');
    if (saved) return saved === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

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
        identity={{ href: '/', title: "AWS What's New 한국어 요약" }}
        utilities={[
          {
            type: 'button',
            iconSvg: isDark ? SunIcon : MoonIcon,
            title: isDark ? '라이트 모드로 전환' : '다크 모드로 전환',
            onClick: () => setIsDark(d => !d),
          },
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
                  <SpaceBetween direction="vertical" size="xxxs">
                    <Link href={item.url} external fontSize="heading-m">
                      {item.title || item.titleEn}
                    </Link>
                    {item.title && item.titleEn && (
                      <Box color="text-body-secondary" fontSize="body-s">{item.titleEn}</Box>
                    )}
                  </SpaceBetween>
                ),
                sections: [
                  {
                    id: 'status',
                    header: '상태',
                    content: item => {
                      const { type, label } = inferStatus(item);
                      return (
                        <SpaceBetween direction="horizontal" size="xs">
                          <StatusIndicator type={type}>{label}</StatusIndicator>
                          <Box color="text-body-secondary" fontSize="body-s">
                            {item.pubDate ? new Date(item.pubDate).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' }) : ''}
                          </Box>
                        </SpaceBetween>
                      );
                    },
                  },
                  {
                    id: 'summary',
                    header: '요약',
                    content: item => {
                      const s = formatSummary(item.summary);
                      return s ? <Box color="text-body-secondary">{s}</Box> : null;
                    },
                  },
                  {
                    id: 'features',
                    header: '주요 기능',
                    content: item => {
                      const list = Array.isArray(item.features)
                        ? item.features
                        : (item.features ? item.features.split(/[,;]/).map(f => f.trim()) : []);
                      const items = list.filter(Boolean).slice(0, 3);
                      if (!items.length) return null;
                      return (
                        <SpaceBetween direction="vertical" size="xxxs">
                          {items.map((f, i) => (
                            <Box key={i} color="text-body-secondary" fontSize="body-s">
                              • {f.length > 50 ? f.slice(0, 50) + '…' : f}
                            </Box>
                          ))}
                        </SpaceBetween>
                      );
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
