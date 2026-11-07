'use strict';

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const readline = require('readline');
const connectDB = require('../db');
const Job = require('../models/Job');
const botConfig = require('../config/botConfig');

let rl = null;
let browser = null;
let logEntries = [];

function log(level, message) {
  const entry = { ts: new Date().toISOString(), level, message };
  logEntries.push(entry);
  const icon = level === 'error' ? '[ERR]' : level === 'warn' ? '[WARN]' : level === 'captcha' ? '[CAPTCHA]' : '[INFO]';
  console.log(icon, message);
}

function randMs(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function flushLogs() {
  try {
    ensureDir(path.dirname(botConfig.logFile));
    fs.writeFileSync(botConfig.logFile, JSON.stringify(logEntries, null, 2));
  } catch (e) {
    console.error('[BOT] Failed to flush logs:', e.message);
  }
}

// ── TIER 3: CAPTCHA / LOGIN DETECTION ──

// async function detectCaptcha(page) {
//   for (const sel of botConfig.captcha.elementSelectors) {
//     const el = await page.$(sel);
//     if (el) {
//       const visible = await el.boundingBox();
//       if (visible) return true;
//     }
//   }
//   return false;
// }

async function detectCaptcha(page) {
  // Target only active challenge panels, ignoring passive badges
  const activeChallengeSelectors = [
    'iframe[src*="api2/bframe"]',           // reCAPTCHA active image puzzle
    'iframe[title*="recaptcha challenge"]', // reCAPTCHA explicit challenge frame
    'iframe[src*="hcaptcha.com/box"]',      // hCaptcha active challenge box
    'iframe[title*="hCaptcha challenge"]'   // hCaptcha challenge frame
  ];

  for (const sel of activeChallengeSelectors) {
    const el = await page.$(sel);
    if (el) {
      const visible = await el.boundingBox();
      // Only trigger if the puzzle frame is actively rendered and visible
      if (visible && visible.width > 0 && visible.height > 0) {
        return true;
      }
    }
  }
  return false;
}

async function detectLoginGate(page) {
  try {
    const hasPasswordField = await page.$('input[type="password"]');
    if (hasPasswordField) return true;
    const currentUrl = page.url().toLowerCase();
    if (/\/login|\/signin|\/auth/.test(currentUrl)) return true;
  } catch (_) {}
  return false;
}

async function waitForHumanIntervention(page, jobTitle, company, gateType) {
  log(gateType === 'login' ? 'captcha' : 'captcha',
    `${gateType === 'login' ? '[LOGIN] Authentication wall' : 'CAPTCHA'} detected for "${jobTitle}" at ${company}.`);
  log('captcha', gateType === 'login'
    ? 'Please log in manually in the browser window, then press ENTER in this terminal to resume...'
    : 'Solve the CAPTCHA manually in the browser, then press ENTER in this terminal to continue...');

  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  }

  return new Promise((resolve) => {
    const checkInterval = setInterval(async () => {
      try {
        const stillBlocked = gateType === 'login'
          ? await detectLoginGate(page)
          : await detectCaptcha(page);
        if (!stillBlocked) {
          clearInterval(checkInterval);
          log('info', (gateType === 'login' ? 'Login resolved' : 'CAPTCHA resolved') + '. Resuming...');
          resolve(true);
        }
      } catch (e) { /* ignore */ }
    }, 3000);

    rl.question('> ', () => {
      clearInterval(checkInterval);
      resolve(true);
    });
  });
}

async function countFormInputs(page) {
  try {
    return await page.evaluate(() => {
      return document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea').length;
    });
  } catch (_) {
    return 0;
  }
}

// ── TIER 1: KNOWN ATS HANDLERS ──

const applicantProfile = {
  socials: {
    linkedin: 'https://www.linkedin.com/in/yourprofile',
    github: 'https://github.com/yourprofile',
    portfolio: 'https://yourportfolio.com',
  },
  visa: {
    sponsorshipAnswer: 'No',
    requiresSponsorshipText: 'I do not require visa sponsorship now or in the future.',
  },
  salary: '100,000 USD',
  experience: '5 years',
  noticePeriod: 'Immediate / 2 weeks',
  discoverySource: 'LinkedIn',
};

const CUSTOM_FIELD_RULES = [
  { keywords: ['linkedin'], value: applicantProfile.socials.linkedin, type: 'text' },
  { keywords: ['github'], value: applicantProfile.socials.github, type: 'text' },
  { keywords: ['portfolio', 'website url', 'personal site'], value: applicantProfile.socials.portfolio, type: 'text' },
  { keywords: ['authorized to work', 'legally authorized', 'work authorization', 'eligible to work'], value: applicantProfile.visa.sponsorshipAnswer, type: 'select' },
  { keywords: ['sponsorship', 'visa', 'immigration', 'require.*sponsor'], value: applicantProfile.visa.sponsorshipAnswer, type: 'select' },
  { keywords: ['salary', 'compensation', 'desired salary', 'pay expectation', 'base pay'], value: applicantProfile.salary, type: 'text' },
  { keywords: ['experience', 'years of experience', 'total experience'], value: applicantProfile.experience, type: 'text' },
  { keywords: ['notice period', 'start date', 'available from', 'availability'], value: applicantProfile.noticePeriod, type: 'text' },
  { keywords: ['hear about', 'how did you', 'source', 'where did you', 'referred by'], value: applicantProfile.discoverySource, type: 'text' },
  { keywords: ['data will be', 'privacy policy', 'terms of use', 'terms and conditions', 'consent', 'i agree', 'i accept'], value: 'check', type: 'checkbox' },
];

function buildSearchString(el) {
  const parts = [el.name, el.id, el.placeholder, el.autocomplete, el['aria-label']];
  if (el.label) parts.push(el.label);
  return parts.filter(Boolean).join(' ').toLowerCase();
}

async function fillCustomFields(page) {
  const elements = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select')).map(el => {
      const tag = el.tagName.toLowerCase();
      const type = tag === 'input' ? (el.getAttribute('type') || 'text').toLowerCase() : tag;
      let label = '';
      if (el.id) {
        const lbl = document.querySelector(`label[for="${el.id}"]`);
        if (lbl) label = lbl.textContent.trim();
      }
      const wrapper = el.closest('label, .field, .form-group, .form-field');
      if (!label && wrapper) {
        const l = wrapper.querySelector('label, .label, span.label-text');
        if (l) label = l.textContent.trim();
      }
      return {
        tag, type,
        name: el.getAttribute('name') || '',
        id: el.getAttribute('id') || '',
        placeholder: el.getAttribute('placeholder') || '',
        autocomplete: el.getAttribute('autocomplete') || '',
        'aria-label': el.getAttribute('aria-label') || '',
        label,
        choices: tag === 'select' ? Array.from(el.options).map(o => o.textContent.trim()).filter(Boolean) : [],
      };
    });
  });

  for (const el of elements) {
    const search = buildSearchString(el);

    for (const rule of CUSTOM_FIELD_RULES) {
      let matched = false;
      for (const kw of rule.keywords) {
        if (new RegExp(kw, 'i').test(search)) { matched = true; break; }
      }
      if (!matched) continue;

      if (rule.type === 'checkbox') {
        if (el.type === 'checkbox') {
          try {
            const handle = await page.evaluateHandle((sel) => {
              if (sel.id) return document.getElementById(sel.id);
              if (sel.name) return document.querySelector(`input[type="checkbox"][name="${sel.name}"]`);
              return null;
            }, { id: el.id, name: el.name });
            const checkbox = handle.asElement();
            if (checkbox) {
              const checked = await (await checkbox.getProperty('checked')).jsonValue();
              if (!checked) {
                await checkbox.click();
                log('info', `Custom: checked consent "${el.label || el.name}"`);
              }
            }
          } catch (_) {}
        }
        break;
      }

      if (el.tag === 'select') {
        try {
          const selected = await page.evaluate(({ name, id, value }) => {
            const sel = document.querySelector(`select[name="${name}"], select[id="${id}"]`);
            if (!sel) return false;
            const target = value.toLowerCase().trim();
            for (const opt of sel.options) {
              const optText = opt.textContent.toLowerCase().trim();
              if (optText === target || optText.includes(target)) {
                sel.value = opt.value;
                sel.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
              }
            }
            for (const opt of sel.options) {
              const optText = opt.textContent.toLowerCase().trim();
              if (target === 'no' && (optText.includes('no') || optText.startsWith('n'))) {
                sel.value = opt.value;
                sel.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
              }
              if (target === 'yes' && (optText.includes('yes') || optText.startsWith('y'))) {
                sel.value = opt.value;
                sel.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
              }
            }
            return false;
          }, { name: el.name, id: el.id, value: rule.value });
          if (selected) log('info', `Custom: selected "${rule.value}" for "${el.label || el.name}"`);
        } catch (_) {}
        break;
      }

      if (el.type === 'radio') {
        try {
          const clicked = await page.evaluate(({ name, value }) => {
            const radios = document.querySelectorAll(`input[type="radio"][name="${name}"]`);
            const target = value.toLowerCase().trim();
            for (const r of radios) {
              const lbl = document.querySelector(`label[for="${r.id}"]`);
              const optText = (lbl ? lbl.textContent : r.value).toLowerCase().trim();
              if (optText.includes(target)) {
                r.click();
                return true;
              }
            }
            return false;
          }, { name: el.name, value: rule.value });
          if (clicked) log('info', `Custom: selected "${rule.value}" for radio "${el.label || el.name}"`);
        } catch (_) {}
        break;
      }

      try {
        const input = await page.$(`input[name="${el.name}"], input[id="${el.id}"], textarea[name="${el.name}"], textarea[id="${el.id}"]`);
        if (input) {
          await safeType(page, input, rule.value);
          log('info', `Custom: filled "${el.label || el.name}" with "${rule.value}"`);
        }
      } catch (_) {}
      break;
    }
  }
}

async function verifyApplicationSuccess(page) {
  await sleep(3000);
  try { await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 }); } catch (_) {}

  const url = page.url().toLowerCase();
  const urlKeywords = ['thank', 'success', 'received', 'submitted', 'post-apply', 'confirmation', 'confirm'];
  const urlMatch = urlKeywords.some(kw => url.includes(kw));

  const bodyText = await page.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => '');
  const textPatterns = [/application received/i, /thank you for applying/i, /success/i, /your application has been submitted/i, /we.ve received your application/i];
  const textMatch = textPatterns.some(p => p.test(bodyText));

  if (urlMatch || textMatch) {
    log('info', 'Application confirmed via success indicators.');
    return true;
  }

  const failurePatterns = [/error/i, /please correct/i, /required field/i, /one-time code/i, /verification code/i, /otp/i, /authenticator/i];
  const isFailure = failurePatterns.some(p => p.test(bodyText));
  if (isFailure) {
    log('warn', 'Post-submit validation/OTP wall detected.');
    return false;
  }

  const stillHasForms = await page.evaluate(() => {
    return document.querySelectorAll('input[type="text"], input[type="email"], input[type="password"]').length;
  }).catch(() => 0);

  if (stillHasForms > 0) {
    log('warn', 'Form elements still present after submit — possible validation block.');
    return false;
  }

  log('info', 'No explicit success/failure indicators — assuming applied.');
  return true;
}

async function takeJobScreenshot(page, job, status) {
  try {
    const dir = path.resolve(__dirname, '..', '..', 'screenshots', status);
    ensureDir(dir);
    const safeCompany = (job.company || 'unknown').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const safeTitle = (job.title || 'untitled').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(dir, `${safeCompany}_${safeTitle}_${ts}.png`);
    await page.screenshot({ path: filePath, fullPage: true });
    log('info', `Screenshot saved: ${filePath}`);
  } catch (e) {
    log('warn', 'Screenshot failed: ' + e.message);
  }
}

async function safeType(page, elementOrSelector, text) {
  try {
    const el = typeof elementOrSelector === 'string' ? await page.$(elementOrSelector) : elementOrSelector;
    if (el) {
      await el.focus();
      await el.click({ clickCount: 3 });
      await page.keyboard.press('Backspace');
      await el.type(text, { delay: 30 });
    }
  } catch (_) {}
}

// async function handleGreenhouse(page, url, job) {
//   log('info', 'Greenhouse ATS detected – using dedicated selectors');
//   const s = botConfig.atsSelectors.greenhouse;
//   const a = botConfig.applicant;

//   try {
//     await page.waitForSelector(s.firstName, { timeout: 10000 });
//     await safeType(page, s.firstName, a.firstName);
//     await safeType(page, s.lastName, a.lastName);
//     await safeType(page, s.email, a.email);
//     if (s.phone) await safeType(page, s.phone, a.phone);

//     const fileInput = await page.$(s.resume);
//     if (fileInput) {
//       const hasFile = await page.evaluate(el => el.files && el.files.length > 0, fileInput).catch(() => false);
//       if (!hasFile) {
//         await fileInput.uploadFile(botConfig.resumePath);
//         log('info', 'Resume uploaded to Greenhouse');
//       }
//     }

//     await sleep(1500);
//     await takeJobScreenshot(page, job, 'applied');
//     const submitBtn = await page.$(s.submit);
//     if (submitBtn) {
//       await submitBtn.click();
//       await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }).catch(() => {});
//       return true;
//     }
//   } catch (e) {
//     log('warn', 'Greenhouse handler failed — falling back to heuristic: ' + e.message);
//     return false;
//   }
//   return false;
// }

async function handleGreenhouse(page, url, job) {
  log('info', 'Greenhouse ATS detected – using dedicated selectors');
  const s = botConfig.atsSelectors.greenhouse;
  const a = botConfig.applicant;

  try {
    // 1. Dismiss Cookie Banner / Modals if they exist
    await page.evaluate(() => {
      const buttons = document.querySelectorAll('button, a');
      for (const b of buttons) {
        const text = b.textContent.trim().toLowerCase();
        if (text === 'ok' || text === 'accept' || text === 'accept all' || text.includes('accept cookies')) {
          b.click();
          break;
        }
      }
    });
    await sleep(1000);

    // 2. Click "Apply" if the form is hidden behind a button landing page
    const formVisible = await page.$('#first_name, input[name*="first" i]');
    if (!formVisible) {
      const applyBtn = await page.evaluateHandle(() => {
        const elements = document.querySelectorAll('button, a');
        for (const el of elements) {
          const txt = el.textContent.trim().toLowerCase();
          if (txt === 'apply' || txt === 'apply now' || txt.includes('apply to position')) {
            return el;
          }
        }
        return null;
      });

      const validBtn = applyBtn.asElement();
      if (validBtn) {
        log('info', 'Form hidden. Clicking Greenhouse "Apply" button to reveal form...');
        await validBtn.click();
        await sleep(3000);
      }
    }

    // 3. Process the application form fields securely
    const firstSelectors = ['#first_name', 'input[name*="first" i]', 'input[autocomplete="given-name"]'];
    const lastSelectors = ['#last_name', 'input[name*="last" i]', 'input[autocomplete="family-name"]'];
    const emailSelectors = ['#email', 'input[type="email"]', 'input[name*="email" i]'];
    const phoneSelectors = ['#phone', 'input[type="tel"]', 'input[name*="phone" i]'];

    let firstNameEl = null;
    for (const sel of firstSelectors) {
      firstNameEl = await page.$(sel);
      if (firstNameEl) break;
    }

    if (!firstNameEl) {
      throw new Error('Could not locate standard Greenhouse field elements.');
    }

    await safeType(page, firstNameEl, a.firstName);

    for (const sel of lastSelectors) {
      const el = await page.$(sel);
      if (el) { await safeType(page, el, a.lastName); break; }
    }

    for (const sel of emailSelectors) {
      const el = await page.$(sel);
      if (el) { await safeType(page, el, a.email); break; }
    }

    for (const sel of phoneSelectors) {
      const el = await page.$(sel);
      if (el) { await safeType(page, el, a.phone); break; }
    }

    // 4. Handle Resume File Attachment
    const fileInput = await page.$('input[type="file"][id*="resume" i], input[type="file"][name*="resume" i], #file-upload-input');
    if (fileInput) {
      const alreadyUploaded = await page.evaluate((el) => el.files && el.files.length > 0, fileInput);
      if (!alreadyUploaded) {
        await fileInput.uploadFile(botConfig.resumePath);
        log('info', 'Resume uploaded to Greenhouse');
      }
    }

    await fillCustomFields(page);
    await sleep(1500);
    await takeJobScreenshot(page, job, 'applied');
    const submitBtn = await page.$('#submit_app, button[type="submit"], input[type="submit"]');
    if (submitBtn) {
      await submitBtn.click();
      const verified = await verifyApplicationSuccess(page);
      return verified;
    }
  } catch (e) {
    log('warn', 'Greenhouse handler failed — falling back to heuristic: ' + e.message);
    return false;
  }
  return false;
}

async function handleLever(page, url, job) {
  log('info', 'Lever ATS detected – using dedicated selectors');
  const s = botConfig.atsSelectors.lever;
  const a = botConfig.applicant;

  try {
    // const applyBtn = await page.$('.postings-btn, a[href*="apply"], button:has-text("Apply for this job"), a:has-text("Apply for this job")');
    const applyBtn = await page.evaluateHandle(() => {
  const elements = document.querySelectorAll('.postings-btn, a, button');
  for (const el of elements) {
    if (el.textContent.includes('Apply for this job') || el.href?.includes('apply') || el.className?.includes('postings-btn')) {
      return el;
    }
  }
  return null;
});

const validBtn = applyBtn.asElement();
if (validBtn) {
  log('info', 'Clicking "Apply for this job" on Lever...');
  await validBtn.click();
  await sleep(3000);
  try { await page.waitForSelector('input[name="name"], input[name="email"]', { timeout: 10000 }); } catch (_) {}
}
    if (applyBtn) {
      log('info', 'Clicking "Apply for this job" on Lever...');
      await applyBtn.click();
      await sleep(3000);
      try { await page.waitForSelector('input[name="name"], input[name="email"]', { timeout: 10000 }); } catch (_) {}
    }

    const nameEl = await page.$(s.firstName);
    if (nameEl) await safeType(page, nameEl, a.firstName + ' ' + a.lastName);

    const emailEl = await page.$(s.email);
    if (emailEl) await safeType(page, emailEl, a.email);

    const phoneEl = await page.$(s.phone);
    if (phoneEl) await safeType(page, phoneEl, a.phone);

    const fileInput = await page.$(s.resume);
    if (fileInput) {
      const hasFile = await page.evaluate(el => el.files && el.files.length > 0, fileInput).catch(() => false);
      if (!hasFile) {
        await fileInput.uploadFile(botConfig.resumePath);
        log('info', 'Resume uploaded to Lever');
      }
    }

    await fillCustomFields(page);
    await sleep(1500);
    await takeJobScreenshot(page, job, 'applied');
    const submitBtn = await page.$(s.submit);
    if (submitBtn) {
      await submitBtn.click();
      const verified = await verifyApplicationSuccess(page);
      return verified;
    }
  } catch (e) {
    log('warn', 'Lever handler failed — falling back to heuristic: ' + e.message);
    return false;
  }
  return false;
}

async function handleAshby(page, url, job) {
  log('info', 'Ashby ATS detected – using dedicated selectors');
  const a = botConfig.applicant;

  try {
    // const tabOrBtn = await page.$('button:has-text("Application"), a:has-text("Application"), button:has-text("Apply to Job"), a:has-text("Apply to Job"), [role="tab"]:has-text("Application")');
    const tabOrBtn = await page.evaluateHandle(() => {
  const elements = document.querySelectorAll('button, a, [role="tab"]');
  for (const el of elements) {
    const txt = el.textContent.trim();
    if (txt === 'Application' || txt === 'Apply to Job') {
      return el;
    }
  }
  return null;
});

const validTab = tabOrBtn.asElement();
if (validTab) {
  log('info', 'Clicking Application tab / Apply button on Ashby...');
  await validTab.click();
  await sleep(2500);
}
    if (tabOrBtn) {
      log('info', 'Clicking Application tab / Apply button on Ashby...');
      await tabOrBtn.click();
      await sleep(2500);
    }

    const firstSelectors = ['input[name*="first" i]', 'input[id*="first" i]', 'input[autocomplete="given-name"]', '#firstName'];
    const lastSelectors = ['input[name*="last" i]', 'input[id*="last" i]', 'input[autocomplete="family-name"]', '#lastName'];
    const emailSelectors = ['input[type="email"]', 'input[name*="email" i]', '#email'];
    const phoneSelectors = ['input[type="tel"]', 'input[name*="phone" i]', 'input[name*="cell" i]', '#phone'];
    const resumeSelectors = ['input[type="file"]', 'input[name*="resume" i]', '#_systemfield_resume'];

    let firstNameEl = null;
    for (const sel of firstSelectors) {
      firstNameEl = await page.$(sel);
      if (firstNameEl) break;
    }

    if (!firstNameEl) {
      throw new Error('Could not find First Name field via advanced selectors.');
    }

    await safeType(page, firstNameEl, a.firstName);

    for (const sel of lastSelectors) {
      const el = await page.$(sel);
      if (el) { await safeType(page, el, a.lastName); break; }
    }

    for (const sel of emailSelectors) {
      const el = await page.$(sel);
      if (el) { await safeType(page, el, a.email); break; }
    }

    for (const sel of phoneSelectors) {
      const el = await page.$(sel);
      if (el) { await safeType(page, el, a.phone); break; }
    }

    for (const sel of resumeSelectors) {
      const fileInput = await page.$(sel);
      if (fileInput) {
        const hasFile = await page.evaluate(el => el.files && el.files.length > 0, fileInput).catch(() => false);
        if (!hasFile) {
          await fileInput.uploadFile(botConfig.resumePath);
          log('info', 'Resume uploaded to Ashby');
        }
        break;
      }
    }

    await fillCustomFields(page);
    await sleep(1500);
    await takeJobScreenshot(page, job, 'applied');
    const submitBtn = await page.$('button[type="submit"], input[type="submit"], button:has-text("Submit")');
    if (submitBtn) {
      await submitBtn.click();
      const verified = await verifyApplicationSuccess(page);
      return verified;
    }
  } catch (e) {
    log('warn', 'Ashby handler failed — falling back to heuristic: ' + e.message);
    return false;
  }
  return false;
}

function checkBlockedDomain(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    for (const blocked of botConfig.blockedDomains) {
      if (hostname.includes(blocked)) return blocked;
    }
  } catch (_) {}
  return null;
}

function matchField(attrs, keywords) {
  const haystack = [attrs.name, attrs.id, attrs.placeholder, attrs['aria-label'], attrs.autocomplete]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  for (const kw of keywords) {
    if (haystack.includes(kw.toLowerCase())) return true;
  }
  return false;
}

async function fillGenericForm(page, job) {
  const config = botConfig;

  const precheck = await page.evaluate(() => {
    const inputs = document.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"], input:not([type])');
    for (const inp of inputs) {
      if (inp.value && inp.value.trim().length > 1) return true;
    }
    const files = document.querySelectorAll('input[type="file"]');
    for (const f of files) {
      if (f.files && f.files.length > 0) return true;
    }
    return false;
  }).catch(() => false);

  if (precheck) {
    log('info', 'Form already filled by primary handler. Skipping fallback to prevent overfilling.');
    return false;
  }

  const fields = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select')).map(el => ({
      tag: el.tagName.toLowerCase(),
      type: (el.getAttribute('type') || 'text').toLowerCase(),
      name: el.getAttribute('name') || '',
      id: el.getAttribute('id') || '',
      placeholder: el.getAttribute('placeholder') || '',
      autocomplete: el.getAttribute('autocomplete') || '',
      'aria-label': el.getAttribute('aria-label') || '',
      required: el.hasAttribute('required'),
    }));
  });

  let resumeUploaded = false;
  let filledCount = 0;

  for (const f of fields) {
    if (f.type === 'file') {
      const input = await page.$(`input[name="${f.name}"], input[id="${f.id}"]`);
      if (input && !resumeUploaded) {
        try {
          await input.uploadFile(config.resumePath);
          resumeUploaded = true;
          filledCount++;
          log('info', 'Resume uploaded to file input: ' + (f.name || f.id));
        } catch (e) {
          log('warn', 'Resume upload failed: ' + e.message);
        }
      }
      continue;
    }

    if (f.tag === 'select') continue; // skip dropdowns — too risky to auto-fill

    let value = null;
    if (matchField(f, config.fieldKeywords.firstName)) value = config.applicant.firstName;
    else if (matchField(f, config.fieldKeywords.lastName)) value = config.applicant.lastName;
    else if (matchField(f, config.fieldKeywords.fullName)) value = config.applicant.firstName + ' ' + config.applicant.lastName;
    else if (matchField(f, config.fieldKeywords.email)) value = config.applicant.email;
    else if (matchField(f, config.fieldKeywords.phone)) value = config.applicant.phone;
    else if (matchField(f, config.fieldKeywords.city)) value = config.applicant.city;
    else if (matchField(f, config.fieldKeywords.website)) continue;
    else if (matchField(f, config.fieldKeywords.linkedin)) continue;
    else if (matchField(f, config.fieldKeywords.coverLetter)) continue;

    if (value) {
      try {
        const input = await page.$(`input[name="${f.name}"], input[id="${f.id}"]`);
        if (input) {
          await safeType(page, input, value);
          filledCount++;
        }
      } catch (e) { /* skip */ }
    }
  }

  log('info', `Heuristic: filled ${filledCount} fields (resume: ${resumeUploaded})`);

  await fillCustomFields(page);

  // click submit
  const submitClicked = await page.evaluate((keywords) => {
    const elements = Array.from(document.querySelectorAll('button, input[type="submit"], a[role="button"]'));
    for (const el of elements) {
      const text = (el.textContent || el.value || '').toLowerCase();
      for (const kw of keywords) {
        if (text.includes(kw)) {
          if (typeof el.click === 'function') { el.click(); return true; }
        }
      }
    }
    return false;
  }, config.submitKeywords);

  if (submitClicked) {
    return await verifyApplicationSuccess(page);
  }

  return true;
}

// ── JOB STATUS UPDATE ──

async function updateJobStatus(jobId, status) {
  try {
    await Job.findByIdAndUpdate(jobId, { status });
    log('info', `DB: ${jobId} → "${status}"`);
  } catch (e) {
    log('error', `DB update failed for ${jobId}: ${e.message}`);
  }
}

// ── MAIN APPLICATION LOOP ──

async function processJob(browser, page, job) {
  const { title, company, applyUrl, url, _id } = job;
  const targetUrl = applyUrl || url;
  let activePage = page;
  log('info', `Processing: "${title}" @ ${company}`);

  try {
    const blockedDomain = checkBlockedDomain(targetUrl);
    if (blockedDomain) {
      log('warn', `Blocked domain "${blockedDomain}" — marking as failed`);
      await updateJobStatus(_id, botConfig.blockedDomainStatus);
      return page;
    }

    try {
      await activePage.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(2000);
    } catch (e) {
      log('error', `Navigation failed for ${targetUrl}: ${e.message}`);
      await updateJobStatus(_id, 'Failed - Navigation Error');
      return activePage;
    }

    // Login gate check
    const loginGate = await detectLoginGate(activePage);
    if (loginGate) {
      await updateJobStatus(_id, 'Pending - Login Required');
      await waitForHumanIntervention(activePage, title, company, 'login');
      return activePage;
    }

    // CAPTCHA check
    const blocked = await detectCaptcha(activePage);
    if (blocked) {
      await updateJobStatus(_id, 'Pending - Captcha');
      if (botConfig.stopOnCaptcha) {
        await waitForHumanIntervention(activePage, title, company, 'captcha');
      }
      return activePage;
    }

    // Tier 1: Known ATS
    let applied = false;
    let formFilled = false;
    const hostname = new URL(targetUrl).hostname;

    try {
      if (hostname.includes('greenhouse.io')) {
        applied = await handleGreenhouse(activePage, targetUrl, job);
      } else if (hostname.includes('lever.co')) {
        applied = await handleLever(activePage, targetUrl, job);
      } else if (hostname.includes('ashbyhq.com')) {
        applied = await handleAshby(activePage, targetUrl, job);
      }

      if (!applied && (hostname.includes('greenhouse.io') || hostname.includes('lever.co') || hostname.includes('ashbyhq.com'))) {
        try {
          const prefillCheck = await activePage.evaluate(() => {
            const inputs = document.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"], input:not([type])');
            for (const inp of inputs) {
              if (inp.value && inp.value.trim().length > 1) return true;
            }
            return false;
          });
          if (prefillCheck) formFilled = true;
        } catch (_) {}
      }

      // Tier 2: Heuristics fallback
      if (!applied && !formFilled) {
        const inputCount = await countFormInputs(activePage);

        if (inputCount === 0) {
          log('warn', 'No form elements found — marking as failed');
          await takeJobScreenshot(activePage, job, 'failed');
          await updateJobStatus(_id, 'Failed - No form elements found');
          return activePage;
        }

        const fallbackResult = await fillGenericForm(activePage, job);
        if (!fallbackResult) {
          await updateJobStatus(_id, 'Failed - Generic form fallback failed');
          return activePage;
        }
      }
    } catch (handlerErr) {
      log('error', 'Handler runtime error: ' + handlerErr.message);
      await takeJobScreenshot(activePage, job, 'failed');
      await updateJobStatus(_id, `Failed - Runtime error: ${handlerErr.message}`);
      return activePage;
    }

    // Post-fill re-checks
    const postLogin = await detectLoginGate(activePage);
    if (postLogin) {
      await updateJobStatus(_id, 'Pending - Login Required');
      await waitForHumanIntervention(activePage, title, company, 'login');
      return activePage;
    }

    const postBlocked = await detectCaptcha(activePage);
    if (postBlocked) {
      await updateJobStatus(_id, 'Pending - Captcha');
      if (botConfig.stopOnCaptcha) {
        await waitForHumanIntervention(activePage, title, company, 'captcha');
      }
      return activePage;
    }

    await updateJobStatus(_id, 'Applied');
    return activePage;
  } catch (e) {
    log('info', 'Tab closed or disconnected by user');
    log('warn', 'Error details: ' + e.message);
    await updateJobStatus(_id, 'Failed - Disconnected');
    try { page = await browser.newPage(); } catch (_) {}
    return page;
  }
}

// ── ENTRY POINT ──

async function runApplyBot() {
  console.log('[BOT] ===== Apply Bot Started =====');
  console.log('[BOT] Config: maxJobs=' + botConfig.maxJobs + ' headless=' + botConfig.browser.headless);

  await connectDB();

  const query = { status: 'Pending' };
  const count = await Job.countDocuments(query);
  log('info', `Found ${count} Pending jobs with valid applyUrl`);

  const jobs = await Job.find(query)
    .limit(botConfig.maxJobs)
    .sort({ scrapedAt: -1 })
    .lean();

  if (jobs.length === 0) {
    log('info', 'No jobs to process. Exiting.');
    process.exit(0);
  }

  log('info', `Pulled ${jobs.length} jobs (hard limit: ${botConfig.maxJobs})`);

  ensureDir(botConfig.browser.userDataDir);

  browser = await puppeteer.launch({
    headless: botConfig.browser.headless,
    slowMo: botConfig.browser.slowMo,
    defaultViewport: botConfig.browser.viewport,
    userDataDir: botConfig.browser.userDataDir,
    args: botConfig.browser.args,
  });

  let page = await browser.newPage();
  page.setDefaultTimeout(botConfig.browser.defaultTimeout);

  let processed = 0;

  for (const job of jobs) {
    try {
      page = await processJob(browser, page, job);
    } catch (outerErr) {
      log('error', 'Unexpected error in processJob: ' + outerErr.message);
      try { await updateJobStatus(job._id, 'Failed - Unexpected Error'); } catch (_) {}
    }

    try {
      await page.evaluate(() => true);
    } catch (pageErr) {
      log('warn', 'Page closed or crashed. Creating new page...');
      try { page = await browser.newPage(); } catch (e) {
        log('error', 'Failed to create new page: ' + e.message);
      }
    }

    processed++;

    if (processed < jobs.length) {
      const pace = randMs(botConfig.pacing.minMs, botConfig.pacing.maxMs);
      log('info', `Pacing: waiting ${(pace / 1000).toFixed(1)}s before next job (${processed}/${jobs.length})`);
      await sleep(pace);
    }
  }

  log('info', `All ${processed} jobs processed.`);

  await browser.close();

  if (rl) rl.close();
  flushLogs();

  log('info', 'Apply bot finished.');
  process.exit(0);
}

module.exports = { runApplyBot };

// allow direct execution: node src/services/applyBot.js
if (require.main === module) {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
  runApplyBot().catch(err => {
    console.error('[BOT] Fatal:', err);
    flushLogs();
    process.exit(1);
  });
}
