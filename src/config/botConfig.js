'use strict';

const path = require('path');

const botConfig = {
  // ── PERSONAL DETAILS ──
  applicant: {
    firstName: 'Alex',
    lastName:  'Khan',
    // email:     'akhan123456009@outlook.com',
    email:     'dummymail123@outlook.com',
    phone:     '+44 7911 123456',
    city:      'London',
  },

  // ── RESUME ──
  resumePath: path.resolve(__dirname, '..', '..', 'data', 'resume.pdf'),

  // ── BATCH LIMITS ──
  maxJobs: 283,             // hard cap — pulls at most 50 Pending jobs per run
  stopOnError: false,      // continue to next job if one fails
  stopOnCaptcha: true,     // pause entire run on captcha

  // ── PACING ──
  pacing: {
    minMs: 15000,          // 15 seconds minimum between applications
    maxMs: 30000,          // 30 seconds maximum
  },

  // ── BROWSER ──
  browser: {
    headless: false,
    slowMo: 40,            // 40ms artificial delay between Puppeteer actions
    viewport: { width: 1366, height: 768 },
    userDataDir: path.resolve(__dirname, '..', '..', 'data', 'puppeteer-profile'),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
    defaultTimeout: 30000,
  },

  // ── TIER 1: KNOWN ATS SELECTORS ──
  atsSelectors: {
    greenhouse: {
      firstName:  '#first_name',
      lastName:   '#last_name',
      email:      '#email',
      phone:      '#phone',
      resume:     'input[type="file"]',
      submit:     '#submit_app',
      location:   '#job_application_location',
    },
    lever: {
      firstName:  'input[name="name"]',
      lastName:   undefined,     // Lever usually has a single name field
      email:      'input[name="email"]',
      phone:      'input[name="phone"]',
      resume:     'input[name="resume"], input[type="file"]',
      submit:     'button[type="submit"], input[type="submit"]',
    },
    ashby: {
      firstName:  'input[name="firstName"], #firstName',
      lastName:   'input[name="lastName"], #lastName',
      email:      'input[name="email"], #email',
      phone:      'input[name="phone"], #phone',
      resume:     'input[type="file"]',
      submit:     'button[type="submit"], input[type="submit"], button:has-text("Submit")',
    },
  },

  // ── TIER 2: GENERIC FORM KEYWORD MAPS ──
  fieldKeywords: {
    firstName:  ['first_name', 'firstname', 'given-name', 'fname', 'forename', 'first'],
    lastName:   ['last_name', 'lastname', 'family-name', 'surname', 'lname', 'last'],
    fullName:   ['full_name', 'fullname', 'name', 'applicant_name', 'your-name'],
    email:      ['email', 'email-address', 'e-mail', 'mail', 'emailaddress'],
    phone:      ['phone', 'telephone', 'tel', 'mobile', 'cell', 'contact', 'phone-number', 'phonenumber'],
    city:       ['city', 'town', 'municipality'],
    resume:     ['resume', 'cv', 'upload', 'attachment', 'file', 'resume-upload', 'cv-upload'],
    coverLetter:['cover_letter', 'coverletter', 'cover-letter', 'message', 'additional', 'why', 'note'],
    linkedin:   ['linkedin', 'linkedin_url', 'linkedin-url', 'linkedinprofile'],
    website:    ['website', 'portfolio', 'url', 'github', 'blog', 'site'],
  },

  // ── TIER 2: SUBMIT BUTTON KEYWORDS ──
  submitKeywords: ['apply', 'submit', 'send', 'submit application', 'send application', 'continue'],

  // ── TIER 3: CAPTCHA DETECTION PATTERNS ──
  captcha: {
    elementSelectors: [
      'iframe[src*="recaptcha"]',
      'iframe[src*="captcha"]',
      'iframe[src*="hcaptcha"]',
      'div.g-recaptcha',
      'div.h-captcha',
      'div[class*="turnstile"]',
      '#cf-challenge-running',
      'iframe[src*="challenges.cloudflare.com"]',
      'div[class*="challenge"]',
    ],
    textPatterns: [
      /are you a robot/i,
      /verify you are human/i,
      /prove you are human/i,
      /security check/i,
      /complete the captcha/i,
      /please verify/i,
      /ddos protection/i,
      /checking your browser/i,
      /cloudflare/i,
    ],
  },

  // ── FAIL-TO-SKIP DOMAINS ──
  blockedDomains: [
    'myworkdayjobs.com',
    'taleo.net',
    'oraclecloud.com',
    'icims.com',
    'brassring.com',
    'successfactors.eu',
    'successfactors.com',
  ],

  blockedDomainStatus: 'Failed - Manual Account Required',

  // ── LOG FILE ──
  logFile: path.resolve(__dirname, '..', '..', 'scripts', 'apply-logs.json'),
};

module.exports = botConfig;
