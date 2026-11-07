'use strict';

const puppeteer = require('puppeteer');
const readline = require('readline');
const botConfig = require('../src/config/botConfig');

(async () => {
  console.log('[WARMUP] Launching browser with profile: ' + botConfig.browser.userDataDir);

  const browser = await puppeteer.launch({
    headless: false,
    userDataDir: botConfig.browser.userDataDir,
    args: botConfig.browser.args,
    defaultViewport: botConfig.browser.viewport,
    slowMo: botConfig.browser.slowMo,
  });

  const page1 = await browser.newPage();
  await page1.goto('https://accounts.google.com', { waitUntil: 'domcontentloaded' });

  const page2 = await browser.newPage();
  await page2.goto('https://www.linkedin.com', { waitUntil: 'domcontentloaded' });

  console.log('');
  console.log('Browser open. Please log into your Google and LinkedIn accounts manually.');
  console.log('Once completed successfully, return to this terminal and press ENTER to save your session profiles.');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.on('line', async () => {
    rl.close();
    console.log('[WARMUP] Closing browser — cookies and session saved to profile.');
    await browser.close();
    process.exit(0);
  });
})();
