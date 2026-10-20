import { describe, expect, it } from 'vitest';
import { DOC_TOPICS, getDocTopic, listDocTopics, searchDocs } from '../app-guide';

describe('App Guide Documentation Module', () => {
  it('has essential topics registered', () => {
    const list = listDocTopics();
    expect(list.length).toBeGreaterThanOrEqual(10);
    const ids = list.map((t) => t.id);
    expect(ids).toContain('overview');
    expect(ids).toContain('builder-requests');
    expect(ids).toContain('environments');
    expect(ids).toContain('scripts-sandbox');
    expect(ids).toContain('runner-and-data');
    expect(ids).toContain('flows');
    expect(ids).toContain('mock-server');
    expect(ids).toContain('protocols');
    expect(ids).toContain('cli');
    expect(ids).toContain('ai-assistant');
    expect(ids).toContain('shortcuts');
  });

  it('retrieves exact topic by id', () => {
    const topic = getDocTopic('cli');
    expect(topic).toBeDefined();
    expect(topic?.title).toContain('CLI');
    expect(topic?.content).toContain('reqx.mjs run');
  });

  it('retrieves topic by keyword', () => {
    const byToken = getDocTopic('token');
    expect(byToken).toBeDefined();
    expect(byToken?.content).toContain('{{ten_bien}}');

    const byScript = getDocTopic('script');
    expect(byScript).toBeDefined();
    expect(byScript?.content).toContain('pm.environment.set');

    const byCsv = getDocTopic('csv');
    expect(byCsv).toBeDefined();

    const byShortcut = getDocTopic('phim tat');
    expect(byShortcut?.id).toBe('shortcuts');
  });

  it('searches docs with keywords', () => {
    const results = searchDocs('CLI terminal');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].id).toBe('cli');

    const envResults = searchDocs('biến môi trường');
    expect(envResults.length).toBeGreaterThanOrEqual(1);
  });

  it('every topic has title, summary, keywords, and non-empty markdown content', () => {
    for (const t of DOC_TOPICS) {
      expect(t.id).toBeTruthy();
      expect(t.title).toBeTruthy();
      expect(t.summary).toBeTruthy();
      expect(t.keywords.length).toBeGreaterThan(0);
      expect(t.content.length).toBeGreaterThan(100);
      expect(t.content).toContain('# ');
    }
  });
});
