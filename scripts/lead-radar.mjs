#!/usr/bin/env node
/**
 * ReqX Lead Radar & Social Scraper
 *
 * Scrapes discussions, inquiries, and complaints about Postman (RAM bloat, cloud sync mandates,
 * runner limits, down times) from public APIs (Hacker News, GitHub Discussions/Issues, Reddit RSS/Search)
 * to find target developer leads for ReqX.
 *
 * Zero external dependencies (uses native fetch in Node 18+).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Keywords indicating strong intent for Postman alternatives or pain points
const KEYWORDS = [
  'postman alternative',
  'postman offline',
  'postman ram bloat',
  'postman scratchpad',
  'postman sync cloud',
  'postman collection runner limit',
  'replace postman'
];

/**
 * 1. Fetch from Hacker News Algolia Search API
 * Free, unauthenticated, rich developer feedback
 */
async function fetchHackerNewsLeads() {
  console.log('🔍 [1/3] Scanning Hacker News (Algolia API)...');
  const leads = [];

  for (const query of ['postman alternative', 'postman ram', 'postman cloud sync']) {
    try {
      const url = `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(query)}&tags=(story,comment)&hitsPerPage=15`;
      const res = await fetch(url, { headers: { 'User-Agent': 'ReqX-LeadRadar/1.0' } });
      if (!res.ok) continue;
      const data = await res.json();

      for (const hit of (data.hits || [])) {
        const text = hit.comment_text || hit.story_text || hit.title || '';
        // Clean HTML tags from HN text
        const cleanText = text.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim();

        // Calculate intent score based on pain points
        let painScore = 0;
        if (/heavy|bloat|slow|lag|electron|ram|memory/i.test(cleanText)) painScore += 2;
        if (/cloud|login|account|offline|scratchpad|privacy/i.test(cleanText)) painScore += 3;
        if (/limit|paywall|pricing|expensive|runner/i.test(cleanText)) painScore += 2;
        if (/alternative|switch|replace|looking for/i.test(cleanText)) painScore += 3;

        const postUrl = hit.story_id
          ? `https://news.ycombinator.com/item?id=${hit.objectID}`
          : hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`;

        leads.push({
          platform: 'Hacker News',
          author: hit.author || 'Anonymous',
          authorUrl: `https://news.ycombinator.com/user?id=${hit.author}`,
          title: hit.story_title || hit.title || `Comment on: ${hit.story_title || 'Postman Discussion'}`,
          url: postUrl,
          date: hit.created_at ? hit.created_at.split('T')[0] : 'recent',
          snippet: cleanText.slice(0, 300) + (cleanText.length > 300 ? '...' : ''),
          score: painScore,
          type: hit._tags?.includes('comment') ? 'comment' : 'story'
        });
      }
    } catch (err) {
      console.warn(`  ⚠️ HN search error for "${query}":`, err.message);
    }
  }

  return leads;
}

/**
 * 2. Fetch from GitHub Search API (Issues & Discussions mentioning Postman alternative)
 */
async function fetchGitHubLeads() {
  console.log('🔍 [2/3] Scanning GitHub Discussions & Issues...');
  const leads = [];

  for (const query of ['postman alternative in:title,body', 'replace postman in:title,body']) {
    try {
      const url = `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&sort=updated&order=desc&per_page=10`;
      const res = await fetch(url, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'ReqX-LeadRadar'
        }
      });

      if (!res.ok) {
        if (res.status === 403) {
          console.warn('  ⚠️ GitHub API rate limit reached (unauthenticated). Skipping.');
          break;
        }
        continue;
      }

      const data = await res.json();
      for (const item of (data.items || [])) {
        const body = (item.body || '').replace(/\s+/g, ' ').trim();
        leads.push({
          platform: 'GitHub',
          author: item.user?.login || 'User',
          authorUrl: item.user?.html_url || '',
          title: item.title,
          url: item.html_url,
          date: item.created_at ? item.created_at.split('T')[0] : 'recent',
          snippet: body.slice(0, 300) + (body.length > 300 ? '...' : ''),
          score: 4,
          type: item.pull_request ? 'PR' : 'Issue/Discussion'
        });
      }
    } catch (err) {
      console.warn(`  ⚠️ GitHub search error for "${query}":`, err.message);
    }
  }

  return leads;
}

/**
 * 3. Fetch from Reddit RSS / Public Search
 */
async function fetchRedditLeads() {
  console.log('🔍 [3/3] Scanning Reddit Communities (r/webdev, r/selfhosted, r/programming)...');
  const leads = [];

  const subreddits = ['webdev', 'selfhosted', 'programming'];
  for (const sub of subreddits) {
    try {
      const url = `https://www.reddit.com/r/${sub}/search.json?q=postman%20alternative&restrict_sr=1&sort=new&limit=10`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 ReqXBot/1.0'
        }
      });

      if (!res.ok) continue;

      const data = await res.json();
      const posts = data.data?.children || [];

      for (const p of posts) {
        const post = p.data;
        if (!post) continue;

        leads.push({
          platform: `Reddit (r/${sub})`,
          author: post.author,
          authorUrl: `https://reddit.com/user/${post.author}`,
          title: post.title,
          url: `https://reddit.com${post.permalink}`,
          date: new Date(post.created_utc * 1000).toISOString().split('T')[0],
          snippet: (post.selftext || post.title).slice(0, 300) + '...',
          score: 5,
          type: 'submission'
        });
      }
    } catch (err) {
      // Reddit often blocks direct cloud requests, silently continue if fails
    }
  }

  return leads;
}

/**
 * Generate personalized outreach draft based on user complaint
 */
function createPitchTemplate(lead) {
  const snippet = lead.snippet.toLowerCase();

  let painAngle = "offline-first & no mandatory cloud account";
  if (snippet.includes('ram') || snippet.includes('bloat') || snippet.includes('heavy') || snippet.includes('slow')) {
    painAngle = "lightweight 100% Rust/WebAssembly core with < 100MB RAM usage";
  } else if (snippet.includes('runner') || snippet.includes('limit') || snippet.includes('25')) {
    painAngle = "completely unlimited local collection runs & stress testing";
  } else if (snippet.includes('security') || snippet.includes('privacy') || snippet.includes('leak') || snippet.includes('cloud')) {
    painAngle = "strict 0-telemetry local storage (your API keys never touch any third-party cloud)";
  }

  return `Hi @${lead.author}, noticed your post about Postman's pain points (${painAngle}). If you're still looking for an alternative, check out ReqX (https://github.com/lgponlylove/reqX). It's open-source, runs 100% offline with zero login required, has built-in local docs inspector & WebLLM AI, and imports Postman collections seamlessly. Hope it helps!`;
}

async function main() {
  console.log('========================================================');
  console.log('🚀 ReqX Lead Radar & Social Intelligence Crawler');
  console.log('========================================================\n');

  const hnLeads = await fetchHackerNewsLeads();
  const ghLeads = await fetchGitHubLeads();
  const redditLeads = await fetchRedditLeads();

  const allLeads = [...hnLeads, ...ghLeads, ...redditLeads];

  // Deduplicate by URL
  const uniqueLeads = Array.from(new Map(allLeads.map(item => [item.url, item])).values());

  // Sort by Pain Score descending
  uniqueLeads.sort((a, b) => b.score - a.score);

  console.log(`\n✅ Found ${uniqueLeads.length} prospective leads discussing Postman alternatives/issues.\n`);

  // Display Top 5 leads in console
  console.log('--- Top High-Intent Leads ---');
  uniqueLeads.slice(0, 6).forEach((lead, i) => {
    console.log(`\n[#${i + 1}] [${lead.platform}] ${lead.title}`);
    console.log(`👤 Author: ${lead.author} (${lead.authorUrl})`);
    console.log(`🔗 Link:   ${lead.url}`);
    console.log(`💬 Snippet: ${lead.snippet}`);
    console.log(`🎯 Suggested Pitch:\n   "${createPitchTemplate(lead)}"`);
  });

  // Export results to Markdown and JSON in postman-clone/leads/
  const outDir = path.join(__dirname, '..', 'leads');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const today = new Date().toISOString().split('T')[0];
  const mdPath = path.join(outDir, `leads-${today}.md`);
  const jsonPath = path.join(outDir, `leads-${today}.json`);

  let mdContent = `# ReqX Target Leads - ${today}\n\n`;
  mdContent += `*Total Leads Identified: ${uniqueLeads.length}*\n\n`;
  mdContent += `| # | Platform | Author | Topic / Context | Intent Score | Action Link |\n`;
  mdContent += `|---|----------|--------|-----------------|--------------|-------------|\n`;

  uniqueLeads.forEach((l, idx) => {
    const safeTitle = (l.title || 'Discussion').replace(/\|/g, '-');
    mdContent += `| ${idx + 1} | ${l.platform} | [${l.author}](${l.authorUrl}) | ${safeTitle} | ⭐ ${l.score} | [View Thread](${l.url}) |\n`;
  });

  mdContent += `\n\n## 📝 Outreach Playbook & Ready-to-Send Templates\n\n`;
  uniqueLeads.slice(0, 15).forEach((l, idx) => {
    mdContent += `### ${idx + 1}. [${l.platform}] ${l.title}\n`;
    mdContent += `- **Thread:** ${l.url}\n`;
    mdContent += `- **User:** [${l.author}](${l.authorUrl})\n`;
    mdContent += `- **Snippet:** > "${l.snippet}"\n`;
    mdContent += `- **Personalized Outreach Reply:**\n`;
    mdContent += `\`\`\`text\n${createPitchTemplate(l)}\n\`\`\`\n\n`;
  });

  fs.writeFileSync(mdPath, mdContent, 'utf-8');
  fs.writeFileSync(jsonPath, JSON.stringify(uniqueLeads, null, 2), 'utf-8');

  console.log(`\n📄 Generated lead report:`);
  console.log(`   - Markdown: ${mdPath}`);
  console.log(`   - JSON:     ${jsonPath}`);
  console.log('========================================================\n');
}

main().catch(err => {
  console.error('Fatal error running Lead Radar:', err);
  process.exit(1);
});
