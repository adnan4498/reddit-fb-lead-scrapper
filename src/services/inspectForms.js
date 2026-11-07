'use strict';

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const connectDB = require('../db');
const Job = require('../models/Job');
const botConfig = require('../config/botConfig');

const OUTPUT_DIR = path.resolve(__dirname, '..', '..', 'form_maps');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function cleanName(str) {
  return (str || 'unknown').replace(/[^a-z0-9]/gi, '_').toLowerCase().substring(0, 80);
}

async function extractFormStructure(page) {
  return await page.evaluate(() => {
    const elements = document.querySelectorAll('input:not([type="hidden"]), textarea, select');
    const fields = [];

    function getLabel(el) {
      if (el.id) {
        const label = document.querySelector(`label[for="${el.id}"]`);
        if (label) return label.textContent.trim();
      }
      const wrapper = el.closest('label, .field, .form-group, .form-field, .input-group');
      if (wrapper) {
        const lbl = wrapper.querySelector('label, .label, span.label-text');
        if (lbl) return lbl.textContent.trim();
      }
      let prev = el.previousElementSibling;
      while (prev) {
        if (prev.tagName === 'LABEL' || prev.classList.contains('label') || prev.classList.contains('form-label')) {
          return prev.textContent.trim();
        }
        if (prev.textContent && prev.textContent.trim().length > 0 && prev.textContent.trim().length < 100 && prev.tagName !== 'DIV') {
          return prev.textContent.trim();
        }
        prev = prev.previousElementSibling;
      }
      const parent = el.parentElement;
      if (parent) {
        const text = parent.textContent.replace(el.value || '', '').trim();
        if (text.length < 100) return text;
      }
      return el.placeholder || '';
    }

    function getOptions(el) {
      if (el.tagName === 'SELECT') {
        return Array.from(el.options).map(o => o.textContent.trim()).filter(Boolean);
      }
      if (el.type === 'radio') {
        const name = el.getAttribute('name');
        if (name) {
          return Array.from(document.querySelectorAll(`input[type="radio"][name="${name}"]`))
            .map(r => {
              const lbl = document.querySelector(`label[for="${r.id}"]`);
              return lbl ? lbl.textContent.trim() : r.value;
            })
            .filter(Boolean);
        }
      }
      return [];
    }

    for (const el of elements) {
      const tag = el.tagName.toLowerCase();
      const type = tag === 'input' ? (el.getAttribute('type') || 'text').toLowerCase() : tag;

      fields.push({
        label: getLabel(el),
        type,
        id: el.getAttribute('id') || '',
        name: el.getAttribute('name') || '',
        placeholder: el.getAttribute('placeholder') || '',
        className: el.getAttribute('class') || '',
        autocomplete: el.getAttribute('autocomplete') || '',
        required: el.hasAttribute('required'),
        options: getOptions(el),
      });
    }

    return fields;
  });
}

async function inspectJob(browser, job) {
  const { title, company, applyUrl, url, _id } = job;
  const targetUrl = applyUrl || url;
  console.log(`[INSPECT] ${title} @ ${company} → ${targetUrl}`);

  const page = await browser.newPage();
  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));

    // ── Dismiss cookie banners ──
    try {
      await page.evaluate(() => {
        const btns = document.querySelectorAll('button, a, [role="button"]');
        for (const b of btns) {
          const txt = (b.textContent || '').toLowerCase().trim();
          if (txt === 'ok' || txt === 'accept' || txt === 'accept cookies' || txt === 'accept all' || txt === 'i agree' || txt === 'agree') {
            b.click();
          }
        }
      });
    } catch (_) {}

    // ── Reveal hidden forms ──
    try {
      const hostname = (new URL(targetUrl)).hostname;
      if (hostname.includes('lever.co')) {
        const handle = await page.evaluateHandle(() => {
          const elms = document.querySelectorAll('a, button');
          for (const el of elms) {
            const txt = (el.textContent || '').trim();
            if (txt.includes('Apply for this job') || el.classList.contains('postings-btn')) return el;
          }
          return null;
        });
        const btn = handle.asElement();
        if (btn) {
          await btn.click();
          await new Promise(r => setTimeout(r, 3000));
        }
      } else if (hostname.includes('ashbyhq.com')) {
        const handle = await page.evaluateHandle(() => {
          const elms = document.querySelectorAll('button, a, [role="tab"]');
          for (const el of elms) {
            const txt = (el.textContent || '').trim();
            if (txt === 'Application' || txt === 'Apply to Job') return el;
          }
          return null;
        });
        const btn = handle.asElement();
        if (btn) {
          await btn.click();
          await new Promise(r => setTimeout(r, 2500));
        }
      } else if (hostname.includes('greenhouse.io')) {
        const visible = await page.$('#first_name');
        if (!visible) {
          const handle = await page.evaluateHandle(() => {
            const elms = document.querySelectorAll('button, a, [role="button"]');
            for (const el of elms) {
              const txt = (el.textContent || '').toLowerCase().trim();
              if (txt.includes('apply') || txt.includes('apply now')) return el;
            }
            return null;
          });
          const btn = handle.asElement();
          if (btn) {
            await btn.click();
            await new Promise(r => setTimeout(r, 3000));
          }
        }
      }
    } catch (_) {}

    const fields = await extractFormStructure(page);

    const result = {
      url: targetUrl,
      title,
      company,
      _id,
      fieldCount: fields.length,
      fields,
      inspectedAt: new Date().toISOString(),
    };

    const subDir = fields.length > 0 ? 'parsed' : 'failed';
    const dir = path.join(OUTPUT_DIR, subDir);
    ensureDir(dir);

    const filename = `${cleanName(company)}_${cleanName(title)}_structure.json`;
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, JSON.stringify(result, null, 2));

    console.log(`[INSPECT] ${fields.length} fields → form_maps/${subDir}/${filename}`);
    return result;
  } catch (e) {
    console.error(`[INSPECT] Failed for ${company}: ${e.message}`);
    return null;
  } finally {
    try { await page.close(); } catch (_) {}
  }
}

async function runInspector() {
  console.log('[INSPECT] ===== Form Inspector Started =====');

  await connectDB();

  const query = { status: 'Pending' };
  const count = await Job.countDocuments(query);
  console.log(`[INSPECT] Found ${count} Pending jobs`);

  const jobs = await Job.find(query)
    .limit(botConfig.maxJobs)
    .sort({ scrapedAt: -1 })
    .lean();

  if (jobs.length === 0) {
    console.log('[INSPECT] No jobs to inspect. Exiting.');
    process.exit(0);
  }

  console.log(`[INSPECT] Pulled ${jobs.length} jobs for inspection`);

  ensureDir(botConfig.browser.userDataDir);

  const browser = await puppeteer.launch({
    headless: botConfig.browser.headless,
    slowMo: botConfig.browser.slowMo,
    defaultViewport: botConfig.browser.viewport,
    userDataDir: botConfig.browser.userDataDir,
    args: botConfig.browser.args,
  });

  let parsed = 0;
  let failed = 0;

  for (let i = 0; i < jobs.length; i++) {
    const result = await inspectJob(browser, jobs[i]);
    if (result && result.fieldCount > 0) parsed++;
    else failed++;
    console.log(`[INSPECT] Progress: ${i + 1}/${jobs.length} (${parsed} parsed, ${failed} failed)`);
  }

  await browser.close();
  console.log(`[INSPECT] Done. ${parsed} parsed, ${failed} failed.`);
  process.exit(0);
}

if (require.main === module) {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
  runInspector().catch(err => {
    console.error('[INSPECT] Fatal:', err);
    process.exit(1);
  });
}

module.exports = { runInspector };
