import * as puppeteer from 'puppeteer-core';
import * as fs from 'fs';

export async function test() {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: false
  });
  const page = await browser.newPage();
  await page.goto('https://example.com');
  await page.screenshot({path: './tmp/example.png'});

  await browser.close();
}

test();
