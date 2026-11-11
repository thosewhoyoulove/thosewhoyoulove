#!/usr/bin/env node
/**
 * Zero-dependency dual-theme SVG generator for GitHub Profile README.
 * Compatible with standard GitHub Actions GITHUB_TOKEN (uses public scalar fields
 * and avoids restricted GraphQL connections like Repository.stargazers).
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(ROOT_DIR, "profile");

const USERNAME = process.env.GITHUB_USERNAME || "thosewhoyoulove";
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";

const THEMES = {
  dark: {
    bgStart: "#0d1117",
    bgEnd: "#131a24",
    surface: "#161b22",
    surfaceAlt: "#1c2330",
    border: "#30363d",
    divider: "#21262d",
    textPrimary: "#e6edf3",
    textSecondary: "#8b949e",
    textMuted: "#6e7681",
    accent: "#58a6ff",
    accentSecondary: "#39c5cf",
    accentTertiary: "#7aa2f7",
    success: "#3fb950",
    successBg: "rgba(63, 185, 80, 0.14)",
    successBorder: "rgba(63, 185, 80, 0.4)",
    pillBg: "#161b22",
    pillBorder: "#30363d",
    trackBg: "#21262d",
    gridLine: "#21262d",
    areaTop: "#58a6ff",
    areaBottom: "#0d1117",
    otherLang: "#6e7681",
  },
  light: {
    bgStart: "#ffffff",
    bgEnd: "#f8fafc",
    surface: "#f6f8fa",
    surfaceAlt: "#eef2f6",
    border: "#d0d7de",
    divider: "#eaeef2",
    textPrimary: "#1f2328",
    textSecondary: "#59636e",
    textMuted: "#8c959f",
    accent: "#0969da",
    accentSecondary: "#0891b2",
    accentTertiary: "#4f46e5",
    success: "#1a7f37",
    successBg: "rgba(26, 127, 55, 0.10)",
    successBorder: "rgba(26, 127, 55, 0.35)",
    pillBg: "#f6f8fa",
    pillBorder: "#d0d7de",
    trackBg: "#eaeef2",
    gridLine: "#eaeef2",
    areaTop: "#0969da",
    areaBottom: "#ffffff",
    otherLang: "#8c959f",
  },
};

const FONT_SANS =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', Ubuntu, sans-serif";
const FONT_MONO =
  "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatNumber(n) {
  return new Intl.NumberFormat("en-US").format(n);
}

async function githubGraphQL(query, variables = {}) {
  if (!TOKEN) {
    throw new Error("Missing GITHUB_TOKEN or GH_TOKEN environment variable.");
  }

  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "thosewhoyoulove-profile-card-generator",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub GraphQL HTTP ${response.status}: ${body}`);
  }

  const payload = await response.json();
  if (payload.errors?.length) {
    const messages = payload.errors.map((e) => e.message).join("; ");
    throw new Error(`GitHub GraphQL errors: ${messages}`);
  }

  return payload.data;
}

async function fetchProfileData(username) {
  const baseData = await githubGraphQL(
    `
    query BaseProfile($login: String!) {
      user(login: $login) {
        login
        name
        createdAt
        followers {
          totalCount
        }
        pullRequests(first: 1) {
          totalCount
        }
        issues(first: 1) {
          totalCount
        }
        allPublicRepos: repositories(privacy: PUBLIC, ownerAffiliations: OWNER) {
          totalCount
        }
        ownRepos: repositories(
          first: 100
          privacy: PUBLIC
          ownerAffiliations: OWNER
          isFork: false
          orderBy: { field: PUSHED_AT, direction: DESC }
        ) {
          totalCount
          nodes {
            name
            stargazerCount
            forkCount
            languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
              edges {
                size
                node {
                  name
                  color
                }
              }
            }
          }
        }
        rollingYear: contributionsCollection {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                date
                contributionCount
              }
            }
          }
        }
      }
    }
    `,
    { login: username }
  );

  const user = baseData.user;
  if (!user) {
    throw new Error(`GitHub user "${username}" not found.`);
  }

  const startYear = new Date(user.createdAt).getUTCFullYear();
  const currentYear = new Date().getUTCFullYear();
  const years = [];
  for (let y = startYear; y <= currentYear; y += 1) {
    years.push(y);
  }

  const yearAliases = years
    .map(
      (y) => `
      y${y}: contributionsCollection(
        from: "${y}-01-01T00:00:00Z"
        to: "${y}-12-31T23:59:59Z"
      ) {
        totalCommitContributions
        totalPullRequestContributions
        totalIssueContributions
        totalRepositoryContributions
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              date
              contributionCount
            }
          }
        }
      }`
    )
    .join("\n");

  const yearlyData = await githubGraphQL(
    `
    query YearlyContributions($login: String!) {
      user(login: $login) {
        ${yearAliases}
      }
    }
    `,
    { login: username }
  );

  let allTimeContributions = 0;
  let allTimeCommits = 0;
  const yearlyTotals = [];
  const dayMap = new Map();

  for (const y of years) {
    const bucket = yearlyData.user[`y${y}`];
    const total = bucket.contributionCalendar.totalContributions;
    allTimeContributions += total;
    allTimeCommits += bucket.totalCommitContributions;
    yearlyTotals.push({ year: y, total });

    for (const week of bucket.contributionCalendar.weeks) {
      for (const day of week.contributionDays) {
        dayMap.set(day.date, day.contributionCount);
      }
    }
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const sortedDays = Array.from(dayMap.entries())
    .filter(([date]) => date <= todayIso)
    .sort(([a], [b]) => a.localeCompare(b));

  let longestStreak = 0;
  let runningStreak = 0;
  let activeDays = 0;
  for (const [, count] of sortedDays) {
    if (count > 0) {
      runningStreak += 1;
      activeDays += 1;
      if (runningStreak > longestStreak) {
        longestStreak = runningStreak;
      }
    } else {
      runningStreak = 0;
    }
  }

  const langTotals = new Map();
  let totalStars = 0;
  for (const repo of user.ownRepos.nodes) {
    totalStars += repo.stargazerCount;
    for (const edge of repo.languages.edges) {
      const prev = langTotals.get(edge.node.name) || {
        name: edge.node.name,
        size: 0,
        color: edge.node.color || "#58a6ff",
      };
      prev.size += edge.size;
      langTotals.set(edge.node.name, prev);
    }
  }

  const totalLangBytes = Array.from(langTotals.values()).reduce(
    (sum, item) => sum + item.size,
    0
  );

  const sortedLangs = Array.from(langTotals.values()).sort(
    (a, b) => b.size - a.size
  );

  const topSix = sortedLangs.slice(0, 6).map((item) => ({
    ...item,
    percent: totalLangBytes > 0 ? (item.size / totalLangBytes) * 100 : 0,
  }));
  const otherBytes = sortedLangs
    .slice(6)
    .reduce((sum, item) => sum + item.size, 0);
  const otherPercent =
    totalLangBytes > 0 ? (otherBytes / totalLangBytes) * 100 : 0;

  const rollingWeeks = user.rollingYear.contributionCalendar.weeks.map(
    (week) => {
      const days = week.contributionDays;
      const total = days.reduce((sum, d) => sum + d.contributionCount, 0);
      return {
        startDate: days[0]?.date || "",
        endDate: days[days.length - 1]?.date || "",
        total,
        days,
      };
    }
  );

  return {
    username: user.login,
    allPublicRepos: user.allPublicRepos.totalCount,
    ownPublicRepos: user.ownRepos.totalCount,
    followers: user.followers.totalCount,
    pullRequests: user.pullRequests.totalCount,
    issues: user.issues.totalCount,
    totalStars,
    allTimeContributions,
    allTimeCommits,
    longestStreak,
    activeDays,
    startYear,
    currentYear,
    yearlyTotals: yearlyTotals.slice(-5),
    topSixLangs: topSix,
    otherPercent,
    rollingYearTotal: user.rollingYear.contributionCalendar.totalContributions,
    rollingWeeks,
  };
}

function renderBannerSvg(themeName) {
  const t = THEMES[themeName];
  const pills = [
    "TypeScript",
    "React 18/19",
    "Vue 3",
    "Next.js",
    "WebRTC",
    "AI Agent",
    "Vite / Webpack",
    "Monorepo",
  ];

  let pillX = 32;
  const pillElements = pills
    .map((label) => {
      const width = Math.round(label.length * 6.9 + 20);
      const el = `
      <g transform="translate(${pillX}, 126)">
        <rect width="${width}" height="24" rx="6" fill="${t.pillBg}" stroke="${t.pillBorder}" stroke-width="1" />
        <text x="${width / 2}" y="15.5" text-anchor="middle" font-family="${FONT_MONO}" font-size="11" font-weight="500" fill="${t.textSecondary}">${escapeXml(label)}</text>
      </g>`;
      pillX += width + 8;
      return el;
    })
    .join("");

  const dots = [];
  for (let gx = 620; gx <= 808; gx += 16) {
    for (let gy = 24; gy <= 152; gy += 16) {
      dots.push(
        `<circle cx="${gx}" cy="${gy}" r="1.2" fill="${t.accent}" opacity="${themeName === "dark" ? "0.14" : "0.12"}" />`
      );
    }
  }

  return `<svg width="840" height="172" viewBox="0 0 840 172" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="thosewhoyoulove - Frontend Engineer">
  <defs>
    <linearGradient id="banner-bg-${themeName}" x1="0" y1="0" x2="840" y2="172" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="${t.bgStart}" />
      <stop offset="100%" stop-color="${t.bgEnd}" />
    </linearGradient>
    <linearGradient id="banner-accent-${themeName}" x1="0" y1="0" x2="280" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="${t.accent}" />
      <stop offset="100%" stop-color="${t.accentSecondary}" />
    </linearGradient>
  </defs>

  <rect x="0.5" y="0.5" width="839" height="171" rx="12" fill="url(#banner-bg-${themeName})" stroke="${t.border}" />
  <rect x="32" y="0.5" width="136" height="2.5" rx="1.25" fill="url(#banner-accent-${themeName})" />

  <g>${dots.join("")}</g>

  <text x="32" y="36" font-family="${FONT_MONO}" font-size="11" font-weight="600" letter-spacing="0.8" fill="${t.accent}">FRONTEND ENGINEER  ·  ARCHITECTURE  ·  RUNTIME  ·  AI AGENT</text>

  <g transform="translate(626, 20)">
    <rect width="182" height="24" rx="12" fill="${t.successBg}" stroke="${t.successBorder}" stroke-width="1" />
    <circle cx="14" cy="12" r="3.5" fill="${t.success}" />
    <text x="25" y="15.5" font-family="${FONT_SANS}" font-size="11" font-weight="600" fill="${t.success}">Open to Frontend Roles</text>
  </g>

  <text x="32" y="76" font-family="${FONT_SANS}" font-size="27" font-weight="700" fill="${t.textPrimary}">Hi, I&apos;m thosewhoyoulove</text>

  <text x="32" y="104" font-family="${FONT_SANS}" font-size="13.5" font-weight="400" fill="${t.textSecondary}">深耕前端工程化与底层运行机制，持续构建 React 原理专栏、Headless 实时通信 SDK 与 TypeScript AI Agent 运行时。</text>

  ${pillElements}
</svg>
`;
}

function renderStatsSvg(data, themeName) {
  const t = THEMES[themeName];

  const metrics = [
    {
      label: "All-Time Contributions",
      value: formatNumber(data.allTimeContributions),
      icon: `<path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-3.5a.75.75 0 0 1 .75.75v2.69l1.78 1.78a.75.75 0 0 1-1.06 1.06l-2-2A.75.75 0 0 1 7.25 8.25v-3A.75.75 0 0 1 8 4.5Z" />`,
    },
    {
      label: "Total Commits",
      value: formatNumber(data.allTimeCommits),
      icon: `<path d="M11.93 8.5a4.002 4.002 0 0 1-7.86 0H.75a.75.75 0 0 1 0-1.5h3.32a4.002 4.002 0 0 1 7.86 0h3.32a.75.75 0 0 1 0 1.5Zm-1.43-.75a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z" />`,
    },
    {
      label: "Original Public Repos",
      value: `${data.ownPublicRepos}`,
      icon: `<path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8Z" />`,
    },
    {
      label: "PRs & Issues",
      value: `${data.pullRequests + data.issues}`,
      icon: `<path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354Z" />`,
    },
    {
      label: "Active / Best Streak",
      value: `${data.activeDays}d / ${data.longestStreak}d`,
      icon: `<path d="M7.998 14.5c2.832 0 5-1.98 5-4.5 0-1.463-.68-2.19-1.879-3.383l-.036-.037c-1.013-1.008-2.3-2.29-2.834-4.434-.322.256-.63.579-.864.953-.432.696-.621 1.58-.046 2.73.473.947.67 2.284-.278 3.232-.61.61-1.548.84-2.403.522a2.72 2.72 0 0 1-1.026-.68C3.22 9.57 3 10.22 3 11c0 2.025 2.049 3.5 4.998 3.5Z" />`,
    },
  ];

  const rowsSvg = metrics
    .map((m, idx) => {
      const y = 66 + idx * 27;
      return `
    <g transform="translate(20, ${y})">
      <g transform="translate(0, -11) scale(0.88)" fill="${t.accent}">
        ${m.icon}
      </g>
      <text x="20" y="0" font-family="${FONT_SANS}" font-size="12" font-weight="500" fill="${t.textSecondary}">${escapeXml(m.label)}</text>
      <text x="242" y="0" text-anchor="end" font-family="${FONT_MONO}" font-size="12" font-weight="700" fill="${t.textPrimary}">${escapeXml(m.value)}</text>
    </g>`;
    })
    .join("");

  const maxYearly = Math.max(...data.yearlyTotals.map((y) => y.total), 1);
  const chartBaseY = 166;
  const maxBarH = 74;
  const barWidth = 15;
  const barGap = 7;
  const startX = 286;

  const barsSvg = data.yearlyTotals
    .map((item, idx) => {
      const bx = startX + idx * (barWidth + barGap);
      const scaledRatio =
        item.total > 0 ? Math.pow(item.total / maxYearly, 0.52) : 0;
      const rawH = Math.round(scaledRatio * maxBarH);
      const bh = item.total > 0 ? Math.max(10, rawH) : 3;
      const by = chartBaseY - bh;
      const isLatest = idx === data.yearlyTotals.length - 1;
      const barColor = isLatest ? t.accentSecondary : t.accent;
      const barOpacity = isLatest ? "1" : "0.8";
      return `
    <g>
      <rect x="${bx}" y="${chartBaseY - maxBarH}" width="${barWidth}" height="${maxBarH}" rx="4" fill="${t.trackBg}" />
      <rect x="${bx}" y="${by}" width="${barWidth}" height="${bh}" rx="4" fill="${barColor}" opacity="${barOpacity}" />
      <text x="${bx + barWidth / 2}" y="${by - 5}" text-anchor="middle" font-family="${FONT_MONO}" font-size="9" font-weight="600" fill="${t.textSecondary}">${item.total}</text>
      <text x="${bx + barWidth / 2}" y="${chartBaseY + 15}" text-anchor="middle" font-family="${FONT_MONO}" font-size="10" fill="${t.textMuted}">&apos;${String(item.year).slice(-2)}</text>
    </g>`;
    })
    .join("");

  return `<svg width="412" height="205" viewBox="0 0 412 205" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="GitHub Overview for ${escapeXml(data.username)}">
  <rect x="0.5" y="0.5" width="411" height="204" rx="12" fill="${t.bgStart}" stroke="${t.border}" />

  <text x="20" y="31" font-family="${FONT_SANS}" font-size="15" font-weight="700" fill="${t.textPrimary}">GitHub Overview</text>
  <text x="392" y="31" text-anchor="end" font-family="${FONT_MONO}" font-size="11" fill="${t.textMuted}">@${escapeXml(data.username)}</text>
  <line x1="20" y1="44" x2="392" y2="44" stroke="${t.divider}" stroke-width="1" />

  ${rowsSvg}

  <line x1="274" y1="56" x2="274" y2="186" stroke="${t.divider}" stroke-width="1" />
  <text x="338" y="66" text-anchor="middle" font-family="${FONT_SANS}" font-size="11" font-weight="600" fill="${t.textSecondary}">Yearly Activity</text>
  ${barsSvg}
</svg>
`;
}

function renderTopLangsSvg(data, themeName) {
  const t = THEMES[themeName];
  const barWidth = 368;
  const barX = 22;
  const barY = 50;

  const segments = [...data.topSixLangs];
  if (data.otherPercent > 0.05) {
    segments.push({
      name: "Other",
      color: t.otherLang,
      percent: data.otherPercent,
    });
  }

  let cursorX = barX;
  const segmentRects = segments
    .map((seg, idx) => {
      const isLast = idx === segments.length - 1;
      const w = isLast
        ? Math.max(0, barX + barWidth - cursorX)
        : Number(((seg.percent / 100) * barWidth).toFixed(2));
      const rect = `<rect x="${cursorX.toFixed(2)}" y="${barY}" width="${w.toFixed(2)}" height="10" fill="${seg.color}" />`;
      cursorX += w;
      return rect;
    })
    .join("\n      ");

  const itemsSvg = data.topSixLangs
    .map((lang, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const x = col === 0 ? 22 : 216;
      const y = 86 + row * 38;
      const itemWidth = 174;
      const miniFillW = Math.max(
        4,
        Math.round((Math.min(lang.percent, 100) / 100) * itemWidth)
      );

      return `
    <g transform="translate(${x}, ${y})">
      <circle cx="5" cy="0" r="4.5" fill="${lang.color}" />
      <text x="15" y="4" font-family="${FONT_SANS}" font-size="12.5" font-weight="600" fill="${t.textPrimary}">${escapeXml(lang.name)}</text>
      <text x="${itemWidth}" y="4" text-anchor="end" font-family="${FONT_MONO}" font-size="11.5" font-weight="600" fill="${t.textSecondary}">${lang.percent.toFixed(1)}%</text>
      <rect x="0" y="12" width="${itemWidth}" height="4" rx="2" fill="${t.trackBg}" />
      <rect x="0" y="12" width="${miniFillW}" height="4" rx="2" fill="${lang.color}" />
    </g>`;
    })
    .join("");

  return `<svg width="412" height="205" viewBox="0 0 412 205" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Most Used Languages for ${escapeXml(data.username)}">
  <defs>
    <clipPath id="lang-bar-clip-${themeName}">
      <rect x="${barX}" y="${barY}" width="${barWidth}" height="10" rx="5" />
    </clipPath>
  </defs>

  <rect x="0.5" y="0.5" width="411" height="204" rx="12" fill="${t.bgStart}" stroke="${t.border}" />

  <text x="22" y="31" font-family="${FONT_SANS}" font-size="15" font-weight="700" fill="${t.textPrimary}">Language Distribution</text>
  <text x="390" y="31" text-anchor="end" font-family="${FONT_MONO}" font-size="11" fill="${t.textMuted}">Original Repos</text>
  <line x1="22" y1="41" x2="390" y2="41" stroke="${t.divider}" stroke-width="1" />

  <rect x="${barX}" y="${barY}" width="${barWidth}" height="10" rx="5" fill="${t.trackBg}" />
  <g clip-path="url(#lang-bar-clip-${themeName})">
    ${segmentRects}
  </g>

  ${itemsSvg}
</svg>
`;
}

function buildSmoothPath(points) {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i === 0 ? 0 : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2 < points.length ? i + 2 : i + 1];

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    const minY = Math.min(p1.y, p2.y);
    const maxY = Math.max(p1.y, p2.y);
    const clampedCp1y = Math.max(minY, Math.min(maxY, cp1y));
    const clampedCp2y = Math.max(minY, Math.min(maxY, cp2y));

    d += ` C ${cp1x.toFixed(2)} ${clampedCp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${clampedCp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

function renderActivitySvg(data, themeName) {
  const t = THEMES[themeName];
  const weeks = data.rollingWeeks;
  const chartLeft = 48;
  const chartRight = 812;
  const chartTop = 62;
  const chartBottom = 166;
  const chartWidth = chartRight - chartLeft;
  const chartHeight = chartBottom - chartTop;

  const rawMax = Math.max(...weeks.map((w) => w.total), 4);
  const niceMax = Math.ceil(rawMax / 4) * 4;
  const activeWeeks = weeks.filter((w) => w.total > 0).length;
  const peakWeek = Math.max(...weeks.map((w) => w.total), 0);

  const points = weeks.map((w, idx) => {
    const x =
      weeks.length > 1
        ? chartLeft + (idx / (weeks.length - 1)) * chartWidth
        : chartLeft;
    const y = chartBottom - (w.total / niceMax) * chartHeight;
    return { x, y, total: w.total, startDate: w.startDate };
  });

  const linePath = buildSmoothPath(points);
  const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(2)} ${chartBottom} L ${points[0].x.toFixed(2)} ${chartBottom} Z`;

  const gridLevels = [0, 0.5, 1];
  const gridSvg = gridLevels
    .map((ratio) => {
      const y = (chartBottom - ratio * chartHeight).toFixed(1);
      const val = Math.round(ratio * niceMax);
      return `
    <line x1="${chartLeft}" y1="${y}" x2="${chartRight}" y2="${y}" stroke="${t.gridLine}" stroke-width="1" stroke-dasharray="${ratio === 0 ? "none" : "4 4"}" />
    <text x="${chartLeft - 10}" y="${Number(y) + 4}" text-anchor="end" font-family="${FONT_MONO}" font-size="10" fill="${t.textMuted}">${val}</text>`;
    })
    .join("");

  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const monthLabels = [];
  let lastMonth = -1;
  let lastLabelX = -100;
  points.forEach((pt) => {
    if (!pt.startDate) return;
    const month = Number(pt.startDate.slice(5, 7)) - 1;
    if (month !== lastMonth) {
      lastMonth = month;
      if (pt.x - lastLabelX >= 44 && pt.x <= chartRight - 14) {
        lastLabelX = pt.x;
        monthLabels.push(
          `<text x="${pt.x.toFixed(1)}" y="188" text-anchor="middle" font-family="${FONT_MONO}" font-size="10" fill="${t.textMuted}">${monthNames[month]}</text>`
        );
      }
    }
  });

  const highlightDots = points
    .filter((pt, idx) => pt.total > 0 && (pt.total === peakWeek || idx === points.length - 1 || pt.total >= niceMax * 0.5))
    .map(
      (pt) =>
        `<circle cx="${pt.x.toFixed(2)}" cy="${pt.y.toFixed(2)}" r="3" fill="${t.bgStart}" stroke="${t.accent}" stroke-width="2" />`
    )
    .join("\n    ");

  return `<svg width="840" height="206" viewBox="0 0 840 206" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="52-Week Contribution Activity for ${escapeXml(data.username)}">
  <defs>
    <linearGradient id="activity-area-${themeName}" x1="0" y1="${chartTop}" x2="0" y2="${chartBottom}" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="${t.areaTop}" stop-opacity="${themeName === "dark" ? "0.32" : "0.22"}" />
      <stop offset="100%" stop-color="${t.areaBottom}" stop-opacity="0.0" />
    </linearGradient>
  </defs>

  <rect x="0.5" y="0.5" width="839" height="205" rx="12" fill="${t.bgStart}" stroke="${t.border}" />

  <text x="24" y="31" font-family="${FONT_SANS}" font-size="15" font-weight="700" fill="${t.textPrimary}">Contribution Activity · Past 52 Weeks</text>
  <text x="812" y="31" text-anchor="end" font-family="${FONT_MONO}" font-size="11" fill="${t.textSecondary}">Last Year: ${formatNumber(data.rollingYearTotal)}  ·  Active Weeks: ${activeWeeks}/${weeks.length}  ·  Peak Week: ${peakWeek}</text>
  <line x1="24" y1="44" x2="812" y2="44" stroke="${t.divider}" stroke-width="1" />

  ${gridSvg}

  <path d="${areaPath}" fill="url(#activity-area-${themeName})" />
  <path d="${linePath}" fill="none" stroke="${t.accent}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />

  ${highlightDots}
  ${monthLabels.join("\n  ")}
</svg>
`;
}

async function main() {
  const data = await fetchProfileData(USERNAME);
  await mkdir(OUTPUT_DIR, { recursive: true });

  const files = {
    "banner-dark.svg": renderBannerSvg("dark"),
    "banner-light.svg": renderBannerSvg("light"),
    "stats-dark.svg": renderStatsSvg(data, "dark"),
    "stats-light.svg": renderStatsSvg(data, "light"),
    "stats.svg": renderStatsSvg(data, "dark"),
    "top-langs-dark.svg": renderTopLangsSvg(data, "dark"),
    "top-langs-light.svg": renderTopLangsSvg(data, "light"),
    "top-langs.svg": renderTopLangsSvg(data, "dark"),
    "activity-dark.svg": renderActivitySvg(data, "dark"),
    "activity-light.svg": renderActivitySvg(data, "light"),
  };

  for (const [filename, svg] of Object.entries(files)) {
    if (!svg.startsWith("<svg") || svg.includes("Something went wrong")) {
      throw new Error(`Validation failed for generated SVG: ${filename}`);
    }
    await writeFile(path.join(OUTPUT_DIR, filename), svg, "utf8");
  }

  console.log(
    `Generated ${Object.keys(files).length} SVG cards for @${data.username} in ${OUTPUT_DIR}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
