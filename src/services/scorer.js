"use strict";

function s(val) {
  return (val || "").toString();
}

// ─────────────────────────────────────────────────────────────────────
// CANDIDATE PROFILE (from CV)
// ─────────────────────────────────────────────────────────────────────
const CANDIDATE = {
  based: "pk",
  years: 4,
  level: "mid-senior",
  needsSponsorship: false,

  goodTitlePatterns: [
    /full[\s-]?stack/i,
    /front[\s-]?end/i,
    /back[\s-]?end/i,
    /\breact\b/i,
    /next\.?js/i,
    /node\.?js/i,
    /\bjavascript\b/i,
    /\btypescript\b/i,
    /web\s+developer/i,
    /web\s+engineer/i,
    /software\s+(?:engineer|developer|dev)/i,
    /\bmern\b/i,
    /product\s+engineer/i,
    /\bui\s+engineer\b/i,
    /application\s+developer/i,
    /\bsde\b/i,
    /\bsde\s*[i1-3]/i,
    /member\s+of\s+technical\s+staff/i,
    /\bmts\b/i,
  ],

  badTitlePatterns: [
    /\b(sales|marketing|recruiter|hr\b|human\s+resources|talent|account\s+exec)/i,
    /\b(data\s+scientist|machine\s+learning|ml\s+engineer|ai\s+research|deep\s+learning)/i,
    /\b(devops|sre|site\s+reliability|platform\s+engineer|infrastructure)/i,
    /\b(qa\b|test\s+engineer|quality\s+assurance|automation\s+test)/i,
    /\b(android|ios\b|mobile\s+engineer|flutter|react\s+native)/i,
    /\b(embedded|firmware|hardware|electrical|mechanical|civil)/i,
    /\b(security\s+engineer|cyber)/i,
    /\b(intern|internship|trainee|apprentice|graduate\s+program)/i,
    /\b(director|vp\b|vice\s+president|head\s+of|chief|cto\b|ceo\b)/i,
    /\b(solutions?\s+architect|enterprise\s+architect|technical\s+architect|software\s+architect)/i,
    /\b(engineering\s+manager|tech\s+lead\s+manager|scrum\s+master)/i,
    // Clearance / defense roles — do not apply from Pakistan.
    /\b(ts\/sci|top\s+secret|security\s+clearance|cleared\s+position|polygraph|dod\s+clearance)/i,
  ],
};

// Seniority keywords that, combined with backend-leaning titles, mean
// "this is a backend leadership role, not ours".
const SENIORITY_LEADERSHIP = /\b(principal|staff|lead|architect|head|director)\b/i;

// ─────────────────────────────────────────────────────────────────────
// Stack classification
// ─────────────────────────────────────────────────────────────────────
const FRONTEND_LOVE = [
  { re: /\breact(?:\.?js)?\b/i,            label: "React" },
  { re: /\bnext\.?js\b/i,                  label: "Next.js" },
  { re: /\bremix\b/i,                      label: "Remix" },
  { re: /\bvue(?:\.?js)?\b/i,              label: "Vue" },
  { re: /\bsvelte(?:kit)?\b/i,             label: "Svelte" },
  { re: /\bastro\b/i,                      label: "Astro" },
  { re: /\btypescript\b/i,                 label: "TypeScript" },
  { re: /\btailwind\b/i,                   label: "Tailwind" },
];

const BACKEND_LOVE = [
  { re: /\bnode(?:\.?js)?\b/i,             label: "Node.js" },
  { re: /\bexpress(?:\.?js)?\b/i,          label: "Express" },
  { re: /\bnest(?:\.?js)?\b/i,             label: "NestJS" },
  { re: /\bfastify\b/i,                    label: "Fastify" },
  { re: /\bdeno\b/i,                       label: "Deno" },
  { re: /\bbun\b/i,                        label: "Bun" },
];

const STACK_REJECT = [
  { re: /\bjava\b/i,                       label: "Java" },
  { re: /\bspring\s*boot\b/i,              label: "Spring Boot" },
  { re: /\bspring\s*framework\b/i,         label: "Spring" },
  { re: /\bkotlin\b/i,                     label: "Kotlin" },
  { re: /\bscala\b/i,                      label: "Scala" },
  { re: /\bgrails\b/i,                     label: "Grails" },
  { re: /\.net\b/i,                        label: ".NET" },
  { re: /\bdotnet\b/i,                     label: ".NET" },
  { re: /\bc#\b/i,                         label: "C#" },
  { re: /\bcsharp\b/i,                     label: "C#" },
  { re: /\basp\.?\s*net\b/i,               label: "ASP.NET" },
  { re: /\bblazor\b/i,                     label: "Blazor" },
  { re: /\bpython\b/i,                     label: "Python" },
  { re: /\bdjango\b/i,                     label: "Django" },
  { re: /\bflask\b/i,                      label: "Flask" },
  { re: /\bfastapi\b/i,                    label: "FastAPI" },
  { re: /\bgolang\b/i,                     label: "Go" },
  { re: /\brust\b/i,                       label: "Rust" },
  { re: /\bruby\b/i,                       label: "Ruby" },
  { re: /\brails\b/i,                      label: "Rails" },
  { re: /\bphp\b/i,                        label: "PHP" },
  { re: /\blaravel\b/i,                    label: "Laravel" },
  { re: /\bsymfony\b/i,                    label: "Symfony" },
  { re: /\belixir\b/i,                     label: "Elixir" },
];

const FRONTEND_REJECT = [
  { re: /\bangular(?:\.?js)?\b/i,          label: "Angular" },
  { re: /\bember\b/i,                      label: "Ember" },
];

const CLOUD_INFRA = [
  { re: /\bkubernetes\b/i,                 label: "Kubernetes" },
  { re: /\bk8s\b/i,                        label: "K8s" },
  { re: /\blambda\b/i,                     label: "Lambda" },
  { re: /\bdynamodb\b/i,                   label: "DynamoDB" },
  { re: /\bapi\s+gateway\b/i,              label: "API Gateway" },
  { re: /\bsqs\b/i,                        label: "SQS" },
  { re: /\bsns\b/i,                        label: "SNS" },
  { re: /\beventbridge\b/i,                label: "EventBridge" },
  { re: /\bserverless\b/i,                 label: "Serverless" },
  { re: /\bdistributed\s+systems?\b/i,     label: "Distributed Systems" },
  { re: /\bcloud[\s-]?native\b/i,          label: "Cloud-Native" },
];

function listMatches(text, patterns) {
  const hits = [];
  for (const p of patterns) {
    if (p.re.test(text)) hits.push(p.label);
  }
  return hits;
}

function countKeyword(text, re) {
  const m = text.match(new RegExp(re.source, "gi"));
  return m ? m.length : 0;
}

// ─────────────────────────────────────────────────────────────────────
// Years-of-experience extractor
// ─────────────────────────────────────────────────────────────────────
function extractRequiredYears(text) {
  if (!text) return 0;
  const patterns = [
    /(\d{1,2})\s*\+\s*years?\s+(?:of\s+)?(?:professional\s+|industry\s+|relevant\s+|hands[- ]on\s+|work\s+|software\s+)?experience/gi,
    /(?:minimum|at\s+least|min\.?|over)\s+(?:of\s+)?(\d{1,2})\s*\+?\s*years?\s+(?:of\s+)?(?:professional\s+|industry\s+|relevant\s+|hands[- ]on\s+|work\s+|software\s+)?experience/gi,
    /(\d{1,2})\s*(?:-|to|–)\s*(\d{1,2})\s*\+?\s*years?\s+(?:of\s+)?(?:professional\s+|industry\s+|relevant\s+|hands[- ]on\s+|work\s+|software\s+)?experience/gi,
  ];
  let maxYears = 0;
  for (const p of patterns) {
    let m;
    while ((m = p.exec(text)) !== null) {
      const a = parseInt(m[1], 10);
      const b = m[2] ? parseInt(m[2], 10) : 0;
      const val = Math.max(a || 0, b || 0);
      if (val > maxYears && val <= 30) maxYears = val;
    }
  }
  return maxYears;
}

// ─────────────────────────────────────────────────────────────────────
// Strict location locks
// ─────────────────────────────────────────────────────────────────────
const STRICT_LOCATION_LOCKS = [
  { pattern: /\bmust\s+be\s+(?:currently\s+)?(?:located|based|residing|resident)\s+in\s+(?:the\s+)?(?:united\s+states|us\b|usa|u\.s\.)/i, label: "US-resident-required" },
  { pattern: /\bmust\s+be\s+(?:currently\s+)?(?:located|based|residing|resident)\s+in\s+(?:the\s+)?(?:united\s+kingdom|uk\b)/i, label: "UK-resident-required" },
  { pattern: /\bmust\s+be\s+(?:currently\s+)?(?:located|based|residing|resident)\s+in\s+(?:the\s+)?canada/i, label: "Canada-resident-required" },
  { pattern: /\bmust\s+be\s+(?:currently\s+)?(?:located|based|residing|resident)\s+in\s+(?:the\s+)?(?:eu|europe|european\s+union)/i, label: "EU-resident-required" },
  { pattern: /\bmust\s+have\s+(?:the\s+)?(?:legal\s+)?right\s+to\s+work\s+in\s+(?:the\s+)?(?:us|usa|united\s+states)/i, label: "US-work-auth-required" },
  { pattern: /\bmust\s+have\s+(?:the\s+)?(?:legal\s+)?right\s+to\s+work\s+in\s+(?:the\s+)?(?:uk|united\s+kingdom)/i, label: "UK-work-auth-required" },
  { pattern: /\bmust\s+have\s+(?:the\s+)?(?:legal\s+)?right\s+to\s+work\s+in\s+(?:the\s+)?(?:eu|europe|germany|france|netherlands|spain|italy)/i, label: "EU-work-auth-required" },
  // "This role is open only to candidates residing in Alberta, British Columbia, ..."
  { pattern: /(?:open|available|limited)\s+only\s+to\s+(?:candidates?|applicants?|residents?)\s+(?:residing|located|based)\s+in\s+(?!pakistan)/i, label: "Residency-restricted" },
  { pattern: /\bonly\s+(?:accepting|considering|hiring)\s+(?:candidates?\s+)?(?:from|in|based\s+in)\s+(?!pakistan)/i, label: "Candidate-region-restricted" },
];

// ─────────────────────────────────────────────────────────────────────
// SERP junk + rule banks
// ─────────────────────────────────────────────────────────────────────
const JUNK_TITLE_PATTERNS = [
  "100+", "jobs in", "vacancies in", "indeed.com", "ziprecruiter.com",
  "linkedin.com", "dice.com", "search results", "jobs near",
];

function isJunkSERP(job) {
  const haystack = (s(job.title) + " " + s(job.company) + " " + s(job.companyName)).toLowerCase();
  return JUNK_TITLE_PATTERNS.some((p) => haystack.includes(p.toLowerCase()));
}

const GLOBAL_REMOTE_KEYWORDS = [
  "worldwide", "global", "anywhere in the world", "work from anywhere",
  "international remote", "anywhere", "remote worldwide", "remote global",
];

const REMOTE_FIRST_COMPANIES = [
  "gitlab", "canonical", "automattic", "buffer", "hotjar", "toptal",
  "turing", "braintrust", "deel", "remote.com", "oyster", "rippling",
  "papaya global", "velocity global", "plane", "skuad", "multiplier",
];

const COUNTRY_LOCKS = [
  { pattern: /\b(us|usa|united\s+states)\s*(?:only|citizens?|person|authorized|based|residents?|work\s+auth)/i, label: "US-only" },
  { pattern: /must\s+be\s+(?:a\s+)?us\s+(?:citizen|person|resident)/i, label: "US-citizen-required" },
  { pattern: /\b(canada|canadian)\s*(?:only|residents?|based)/i, label: "Canada-only" },
  { pattern: /\b(uk|united\s+kingdom)\s*(?:only|residents?|based)/i, label: "UK-only" },
  { pattern: /\b(eu|european\s+union)\s*(?:only|residents?|based|citizens?)/i, label: "EU-only" },
  { pattern: /\b(australia|australian)\s*(?:only|residents?|based)/i, label: "Australia-only" },
  { pattern: /\b(germany|german)\s*(?:only|residents?|based)/i, label: "Germany-only" },
  { pattern: /\b(france|french)\s*(?:only|residents?|based)/i, label: "France-only" },
  { pattern: /\b(india|indian)\s*(?:only|residents?|based)/i, label: "India-only" },
  { pattern: /\b(singapore|sg)\s*(?:only|residents?|based)/i, label: "Singapore-only" },
  { pattern: /remote\s*[\(\[-]?\s*(?:eu|europe|usa?|uk|canada|australia)\s*[\)\]-]?\s*(?:only)?/i, label: "Region-locked" },
];

const HARD_NEGATIVES = [
  "us citizenship required", "must be us citizen", "no visa sponsorship",
  "no sponsorship available", "we do not sponsor",
  "must already possess work authorization", "w2 only", "no c2c",
  "w2/c2c", "onsite only", "on-site only", "no remote", "must relocate",
];

const SCORING_RULES = [
  { keywords: GLOBAL_REMOTE_KEYWORDS, points: 35, label: "Global Remote" },
  { keywords: REMOTE_FIRST_COMPANIES, points: 25, label: "Remote-First Company" },
  { keywords: ["deel", "remote.com", "oyster", "rippling", "papaya global",
               "velocity global", "plane", "skuad", "multiplier"], points: 30, label: "EOR Platform" },
  { keywords: ["emea", "apac", "asia", "asia-pacific", "mena", "remote europe"], points: 20, label: "Region Overlap" },
  { keywords: ["gitlab", "canonical", "automattic", "buffer", "hotjar",
               "toptal", "turing", "braintrust"], points: 20, label: "Global Employer" },
  { keywords: ["saas", "b2b saas", "product company", "startup",
               "series a", "series b", "yc-backed", "y combinator"], points: 10, label: "Product/Startup" },
  { keywords: ["remote-first", "fully remote", "remote first", "work from home",
               "wfh", "distributed team", "async", "asynchronous"], points: 15, label: "Remote Culture" },
  { keywords: ["contractor", "b2b contract", "eor", "employer of record",
               "independent contractor", "freelance", "long-term contract"], points: 10, label: "Contract/EOR" },
  { keywords: ["visa sponsorship", "relocation assistance", "relocation package",
               "work permit sponsorship", "sponsorship available"], points: 20, label: "Visa / Relocation" },
  { keywords: ["react", "react.js", "reactjs"], points: 20, label: "React" },
  { keywords: ["next.js", "nextjs", "next js"], points: 15, label: "Next.js" },
  { keywords: ["node.js", "nodejs", "node js"], points: 15, label: "Node.js" },
  { keywords: ["typescript"], points: 12, label: "TypeScript" },
  { keywords: ["full-stack", "fullstack", "full stack"], points: 15, label: "Full-Stack" },
  { keywords: ["express.js", "expressjs"], points: 8, label: "Express" },
  { keywords: ["prisma", "postgresql", "postgres"], points: 8, label: "Prisma/PG" },
  { keywords: ["mongodb", "mongo"], points: 6, label: "MongoDB" },
  { keywords: ["graphql"], points: 5, label: "GraphQL" },
  { keywords: ["docker"], points: 5, label: "Docker" },
  { keywords: ["redis"], points: 4, label: "Redis" },
  { keywords: ["aws"], points: 4, label: "AWS" },
  { keywords: ["tailwind"], points: 3, label: "Tailwind" },
  { keywords: ["no meetings", "async first", "flexible hours",
               "timezone overlap", "four-day week"], points: 8, label: "Async-friendly" },
];

const FRONTEND_GATED_RULES = new Set(["React", "Next.js", "TypeScript", "Tailwind"]);

function matchesAny(text, patterns) {
  for (const p of patterns) {
    if (typeof p === "string") { if (text.includes(p.toLowerCase())) return p; continue; }
    if (p instanceof RegExp)   { if (p.test(text)) return p.source; continue; }
    if (p && p.pattern instanceof RegExp) {
      if (p.pattern.test(text)) return p.label || p.pattern.source;
      continue;
    }
  }
  return null;
}

function isFrontendDominant(title, descHead) {
  if (/\b(react|next\.?js|front[\s-]?end|mern)\b/i.test(title)) return true;
  const firstChunk = descHead.slice(0, 600);
  if (/\b(react|next\.?js)\b/i.test(firstChunk)) return true;
  const reactCount = (descHead.match(/\breact\b/gi) || []).length;
  const nextCount  = (descHead.match(/\bnext\.?js\b/gi) || []).length;
  return reactCount + nextCount >= 3;
}

// ─────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────
function scoreJob(job) {
  const title = s(job.title).toLowerCase();
  const company = s(job.company || job.companyName).toLowerCase();
  const location = s(job.location || job.region).toLowerCase();
  const description = s(job.description).toLowerCase();
  const notes = s(job.notes).toLowerCase();
  const searchText = [title, company, location, description, notes].join(" ");
  const descHead = description.slice(0, 4000);
  const descFull = description.slice(0, 12000);

  // ── Hard disqualifiers ──
  if (isJunkSERP(job))
    return { score: 0, status: "DISCARD", matchedRules: ["Junk SERP"] };

  for (const pattern of HARD_NEGATIVES) {
    if (searchText.includes(pattern))
      return { score: 0, status: "DISCARD", matchedRules: ["Hard negative: " + pattern] };
  }

  // ── Title gate ──
  const titleMatch = matchesAny(title, CANDIDATE.goodTitlePatterns);
  if (!titleMatch)
    return { score: 0, status: "DISCARD", matchedRules: ["Not a dev role"] };

  const badTitleHit = matchesAny(title, CANDIDATE.badTitlePatterns);
  if (badTitleHit)
    return { score: 0, status: "DISCARD", matchedRules: ["Wrong title: " + badTitleHit] };

  // ─────────────────────────────────────────────────────────────────
  // TITLE-ONLY VETOES — work even when description is missing
  // ─────────────────────────────────────────────────────────────────

  // Principal / Staff / Lead on a backend-leaning title → DISCARD.
  const isSeniorStaff = /\b(principal|staff|head\s+of|chief|director|vp|vice\s+president)\b/i.test(title);
  const isLead = /\b(lead|tech\s+lead|team\s+lead)\b/i.test(title);
  const hasBackendSignal =
    /\b(back[\s-]?end|backend|fullstack\/backend|full[\s-]?stack\/backend|java|\.net|dotnet|c#|csharp|python|golang|rust|ruby|php|spring|aws|k8s|kubernetes)\b/i.test(title);
  if (isSeniorStaff && hasBackendSignal) {
    return { score: 0, status: "DISCARD", matchedRules: ["Senior staff + backend title"] };
  }
  if (isLead && hasBackendSignal) {
    return { score: 0, status: "DISCARD", matchedRules: ["Lead + backend title"] };
  }

  // Rejected stack keyword in title → DISCARD.
  if (/\b(java|\.net|dotnet|c#|csharp|spring\s*boot|php|laravel|golang|ruby|rails|rust|kotlin|scala)\b/i.test(title)) {
    return { score: 0, status: "DISCARD", matchedRules: ["Rejected stack in title"] };
  }

  // Years-of-experience mentioned in title.
  const titleYears = title.match(/\b(\d{1,2})\s*\+?\s*(?:years|yrs|yoe)\b/i);
  if (titleYears && parseInt(titleYears[1], 10) >= 6) {
    return { score: 0, status: "DISCARD", matchedRules: ["Title requires " + titleYears[1] + "+ years"] };
  }

  // ─────────────────────────────────────────────────────────────────
  // DEEPER TITLE/STACK VETOES (still work without description)
  // ─────────────────────────────────────────────────────────────────
  const rejectTitleHits         = listMatches(title, STACK_REJECT);
  const frontendLoveTitleHits   = listMatches(title, FRONTEND_LOVE);
  const backendLoveTitleHits    = listMatches(title, BACKEND_LOVE);
  const rejectFrontendTitleHits = listMatches(title, FRONTEND_REJECT);

  if (rejectTitleHits.length > 0 &&
      frontendLoveTitleHits.length === 0 &&
      backendLoveTitleHits.length === 0) {
    return { score: 0, status: "DISCARD",
      matchedRules: ["Title is rejected stack: " + rejectTitleHits.join(", ")] };
  }

  const titleHasFrontend = /\b(front[\s-]?end|react|next\.?js|vue|svelte|web\s+(?:dev|engineer)|ui\s+engineer|mern)\b/i.test(title);
  const titleHasBackendOnly =
    /\b(back[\s-]?end|java|\.net|dotnet|c#|csharp|python|golang|rust|ruby|php|spring)\b/i.test(title) &&
    !titleHasFrontend;
  if (titleHasBackendOnly) {
    return { score: 0, status: "DISCARD",
      matchedRules: ["Backend-heavy title, not our focus"] };
  }

  if (rejectFrontendTitleHits.length > 0 && frontendLoveTitleHits.length === 0) {
    return { score: 0, status: "DISCARD",
      matchedRules: ["Title frontend mismatch: " + rejectFrontendTitleHits.join(", ")] };
  }

  // ── DESCRIPTION-BASED VETOES (fire only if description exists) ──
  const rejectDescHits          = listMatches(descHead, STACK_REJECT);
  const frontendLoveDescHits    = listMatches(descHead, FRONTEND_LOVE);
  const backendLoveDescHits     = listMatches(descHead, BACKEND_LOVE);
  const rejectFrontendDescHits  = listMatches(descHead, FRONTEND_REJECT);
  const cloudInfraHits          = listMatches(descHead, CLOUD_INFRA);

  const loveCount = frontendLoveDescHits.length + backendLoveDescHits.length;
  if (rejectDescHits.length >= 3 && loveCount === 0) {
    return { score: 0, status: "DISCARD",
      matchedRules: ["Description dominated by rejected stack: " + rejectDescHits.join(", ")] };
  }

  const javaCount   = countKeyword(descFull, /\bjava\b/i);
  const reactCount  = countKeyword(descFull, /\breact\b/i);
  const nextCount   = countKeyword(descFull, /\bnext\.?js\b/i);
  const nodeCount   = countKeyword(descFull, /\bnode(?:\.?js)?\b/i);
  const tsCount     = countKeyword(descFull, /\btypescript\b/i);
  const frontendCount = reactCount + nextCount + nodeCount + tsCount;

  if (javaCount >= 2 && frontendCount <= 2) {
    return { score: 0, status: "DISCARD",
      matchedRules: ["Java-heavy JD (java×" + javaCount + ", frontend×" + frontendCount + ")"] };
  }
  if (javaCount >= 1 && cloudInfraHits.length >= 3 && frontendCount <= 2) {
    return { score: 0, status: "DISCARD",
      matchedRules: ["Java + cloud-infra JD: " + cloudInfraHits.slice(0,3).join(", ")] };
  }
  if (cloudInfraHits.length >= 4 && frontendCount <= 2) {
    return { score: 0, status: "DISCARD",
      matchedRules: ["Cloud-infra dominated JD: " + cloudInfraHits.slice(0,4).join(", ")] };
  }

  const yearsRequired = extractRequiredYears(descHead);
  if (yearsRequired >= 8) {
    return { score: 0, status: "DISCARD",
      matchedRules: ["Requires " + yearsRequired + "+ years"] };
  }
  if (yearsRequired >= 6 && frontendLoveDescHits.length < 2) {
    return { score: 0, status: "DISCARD",
      matchedRules: ["Requires " + yearsRequired + "+ years, weak frontend match"] };
  }

  for (const lock of STRICT_LOCATION_LOCKS) {
    if (lock.pattern.test(searchText)) {
      return { score: 0, status: "DISCARD",
        matchedRules: ["Strict lock: " + lock.label] };
    }
  }

  // ── Passed vetoes. Now score. ──
  let score = 20;
  const matchedRules = ["Dev role (+20)"];

  if (/full[\s-]?stack/i.test(title))      { score += 15; matchedRules.push("Full-Stack title (+15)"); }
  else if (/front[\s-]?end/i.test(title))  { score += 12; matchedRules.push("Frontend title (+12)"); }
  else if (/\breact\b/i.test(title))       { score += 15; matchedRules.push("React title (+15)"); }
  else if (/next\.?js/i.test(title))       { score += 12; matchedRules.push("Next.js title (+12)"); }
  else if (/node/i.test(title))            { score += 12; matchedRules.push("Node title (+12)"); }

  if (/\b(mid|mid-level|intermediate)\b/i.test(title)) { score += 8; matchedRules.push("Mid-level (+8)"); }
  else if (/\b(senior|sr\.?|lead)\b/i.test(title))     { score += 5; matchedRules.push("Senior (+5)"); }
  else if (/\b(junior|jr\.?)\b/i.test(title))          { score += 3; matchedRules.push("Junior (+3)"); }

  const hasRemote       = /\bremote\b/i.test(title + " " + location);
  const isGlobal        = matchesAny(searchText, GLOBAL_REMOTE_KEYWORDS) !== null;
  const hasGlobalCompany = matchesAny(company, REMOTE_FIRST_COMPANIES) !== null;

  if (hasRemote && (isGlobal || hasGlobalCompany)) {
    score += 30; matchedRules.push("Remote + global signals (+30)");
  } else if (hasRemote) {
    const lockHit = matchesAny(searchText, COUNTRY_LOCKS);
    if (lockHit) { score += 8; matchedRules.push("Remote but country-locked: " + lockHit + " (+8)"); }
    else { score += 20; matchedRules.push("Remote, no explicit country lock (+20)"); }
  }

  const frontendDominant = isFrontendDominant(title, descHead);
  const appliedLabels = new Set();
  for (const rule of SCORING_RULES) {
    if (appliedLabels.has(rule.label)) continue;
    if (FRONTEND_GATED_RULES.has(rule.label) && !frontendDominant) continue;
    for (const kw of rule.keywords) {
      if (searchText.includes(kw.toLowerCase())) {
        score += rule.points;
        matchedRules.push(rule.label + " (+" + rule.points + ")");
        appliedLabels.add(rule.label);
        break;
      }
    }
  }

  if (hasRemote && isGlobal && /full[\s-]?stack/i.test(title) && /react|next/i.test(title)) {
    score += 10; matchedRules.push("Global remote full-stack React (+10)");
  }

  if (titleHasFrontend && rejectDescHits.length >= 2 && frontendLoveDescHits.length <= 1) {
    score -= 25;
    matchedRules.push("Backend-heavy JD penalty (-25)");
  }
  if (rejectFrontendDescHits.length >= 2 && frontendLoveDescHits.length === 0) {
    score -= 15;
    matchedRules.push("Frontend mismatch: " + rejectFrontendDescHits.join(", ") + " (-15)");
  }
  if (yearsRequired >= 6) {
    score -= 15;
    matchedRules.push("High years requirement (" + yearsRequired + "+) penalty (-15)");
  }
  if (cloudInfraHits.length >= 2 && frontendCount <= 3) {
    score -= 20;
    matchedRules.push("Cloud-infra heavy JD penalty (-20)");
  }

  score = Math.max(0, Math.min(score, 100));

  let tier;
  if (score >= 70) tier = "TIER_1_HIGH";
  else if (score >= 40) tier = "TIER_2_MEDIUM";
  else if (score >= 20) tier = "TIER_3_LOW";
  else tier = "DISCARD";

  return { score, status: tier, matchedRules };
}

module.exports = { scoreJob, extractRequiredYears, listMatches };