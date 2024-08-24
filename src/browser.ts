import * as puppeteer from 'puppeteer-core';
import prompts from 'prompts';
import dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config();

export function GetCourseInfos(auth: {
  username: string;
  password: string;
  termId?: string;
}): Promise<{
  sectionTimes: SectionTime[];
  courseInfos: CourseInfo[];
  termName: string;
  name: string;
}> {
  return new Promise(async (resolve, reject) => {
    console.log('Starting Headless Browser..');
    const browser = await puppeteer.launch({
      executablePath:
        process.env.CHROMIUM_PATH ||
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      headless: true,
    });
    const page = await browser.newPage();
    await page.goto('https://cj.shu.edu.cn');

    const username = await page.$('#username');
    await username?.type(auth.username);
    const password = await page.$('#password');
    await password?.type(auth.password);

    const submit = await page.$('#submit-button');
    console.log('Logging in..');
    await submit?.click();

    await page.waitForNavigation({
      timeout: 5000,
    });

    if (page.url() !== 'https://cj.shu.edu.cn/Home/StudentIndex') {
      reject('登录失败');
    }

    await page.goto('https://cj.shu.edu.cn/StudentPortal/StudentSchedule');

    await page.waitForSelector('#AcademicTermID');

    const terms = (await page.evaluate(() => {
      return Array.prototype.map.call(
        (document.querySelector('#AcademicTermID') as HTMLSelectElement)
          ?.options,
        (v) => {
          return { value: v.value, title: v.innerText };
        }
      );
    })) as { value: string; title: string }[];

    // const response = await prompts({
    //   type: 'select',
    //   name: 'term',
    //   message: '为哪一个学期查询课表？',
    //   choices: terms.reverse().slice(0, 3),
    // });

    // if (!response.term) reject('未选择学期');

    const termid = auth.termId || terms.reverse()[0].value;

    await page.evaluate((term) => {
      (document.querySelector('#AcademicTermID') as HTMLSelectElement).value =
        term;
      // @ts-ignore
      window.CtrlStudentSchedule();
    }, termid);

    await page.waitForSelector('#divEditPostponeApply');

    await page.screenshot({ path: './tmp/example.png' });

    await page.addScriptTag({
      content: fs.readFileSync('./dist/parser.js', 'utf-8'),
    });

    const result = (await page.evaluate(() => {
      return scheduleHtmlParser();
    })) as { sectionTimes: SectionTime[]; courseInfos: CourseInfo[] };

    const name = (await page.evaluate(() => {
      return Array.prototype.find
        .call(document.getElementsByTagName('div'), (v) =>
          v.innerText.startsWith('姓名')
        )
        .innerText.split('：')[1];
    })) as string;

    await browser.close();

    resolve({
      ...result,
      termName: terms.find((v) => v.value === termid)?.title || '',
      name,
    });
  });
}
