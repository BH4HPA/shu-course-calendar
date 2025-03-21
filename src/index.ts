import * as ics from 'ics';
import express from 'express';
import dayjs from 'dayjs';
import * as fs from 'fs';

import { GetCourseInfos, GetTermList } from './browser';
import { randomFilename, RefreshCdn, UploadFile } from './upload';
import { getAllTerms, getCourseInfos } from './courses';
import { SectionTime, CourseInfo } from './parser';

function convertTimeToICSTime(date: Date): ics.DateTime {
  return [
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
  ];
}

function convertSectionLengthToDuration(
  length: number,
  startSection: number
): ics.DurationObject {
  const bigIntervalStart = startSection % 2 === 0;
  const duration =
    length * 45 +
    Math.floor((length - 1) / 2) * (bigIntervalStart ? 10 : 20) +
    Math.floor(length / 2) * (bigIntervalStart ? 20 : 10);
  return { hours: Math.floor(duration / 60), minutes: duration % 60 };
}

function computeStartTime(
  termStart: Date,
  sectionTime: SectionTime[],
  week: number,
  day: number,
  startSection: number,
  replacement: IHolidayReplacement[]
) {
  const startTime = replaceDateByHoliday(termStart, week, day, replacement);
  startTime.setHours(
    parseInt(sectionTime[startSection - 1].startTime.split(':')[0] || '0')
  );
  startTime.setMinutes(
    parseInt(sectionTime[startSection - 1].startTime.split(':')[1] || '0')
  );
  return convertTimeToICSTime(startTime);
}

function getWeekPatternMode(weekPattern: number) {
  if (weekPattern === 0b0101010101 || weekPattern === 0b1010101010)
    return 'odd-even';
  let lastBit = weekPattern & 0x1;
  let toggleTimes = 0;
  for (let i = 1; i < 10; i++) {
    const bit = (weekPattern >> i) & 0x1;
    if (bit !== lastBit) {
      toggleTimes++;
    }
    lastBit = bit;
  }
  if (toggleTimes <= 2) return 'continuous';
  return 'other';
}

function computeCourseEndTime(termStartDate: Date, courseLastWeek: number) {
  const endTime = new Date(termStartDate);
  endTime.setDate(endTime.getDate() + courseLastWeek * 7);
  endTime.setDate(endTime.getDate() - 1);
  return `${endTime.getFullYear().toString().padStart(4, '0')}${(
    endTime.getMonth() + 1
  )
    .toString()
    .padStart(2, '0')}${endTime.getDate().toString().padStart(2, '0')}T000000Z`;
}

interface IHolidayReplacement {
  topic: string;
  from: string;
  to: string;
  replace: {
    [replaceDate: string]: string;
  };
}

const HolidayReplacement: IHolidayReplacement[] = [
  {
    topic: '清明节',
    from: '2025-04-04',
    to: '2025-04-04',
    replace: {},
  },
  {
    topic: '劳动节',
    from: '2025-05-01',
    to: '2025-05-05',
    replace: {
      '2025-05-05': '2025-04-27',
    },
  },
];

function convertDateToYYYYMMDD(date: Date) {
  return `${date.getFullYear().toString().padStart(4, '0')}-${(
    date.getMonth() + 1
  )
    .toString()
    .padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
}

function isInHoliday(
  termStart: Date,
  week: number,
  day: number,
  replacements: IHolidayReplacement[]
) {
  const startTime = new Date(termStart);
  startTime.setDate(startTime.getDate() + (week - 1) * 7 + day - 1);
  const date_raw = convertDateToYYYYMMDD(startTime);
  const date = dayjs(date_raw);
  for (const replacement of replacements) {
    const start = dayjs(replacement.from);
    const end = dayjs(replacement.to);
    if (date.isAfter(start.add(-1, 'day')) && date.isBefore(end.add(1, 'day')))
      if (!replacement.replace[date_raw]) return true;
  }
  return false;
}

function replaceDateByHoliday(
  termStart: Date,
  week: number,
  day: number,
  replacements: IHolidayReplacement[]
): Date {
  const startTime = new Date(termStart);
  startTime.setDate(startTime.getDate() + (week - 1) * 7 + day - 1);
  const date_raw = convertDateToYYYYMMDD(startTime);
  const date = dayjs(date_raw);
  for (const replacement of replacements) {
    const start = dayjs(replacement.from);
    const end = dayjs(replacement.to);
    if (date.isAfter(start.add(-1, 'day')) && date.isBefore(end.add(1, 'day')))
      if (!replacement.replace[date_raw]) return startTime;
      else return new Date(replacement.replace[date_raw]);
  }
  return startTime;
}

function generateCalendar(
  courseInfos: CourseInfo[],
  sectionTimes: SectionTime[],
  termStartDate: Date,
  termName: string,
  name: string,
  holidayReplacements: IHolidayReplacement[]
): Promise<{
  events: ics.EventAttributes[];
  ics: string;
}> {
  return new Promise((resolve, reject) => {
    const weekEvents: ics.EventAttributes[][] = courseInfos.map(
      (courseInfo) => {
        return courseInfo.weeks
          .filter(
            (week) =>
              !isInHoliday(
                termStartDate,
                week,
                courseInfo.day,
                holidayReplacements
              )
          )
          .map((week) => {
            return {
              start: computeStartTime(
                termStartDate,
                sectionTimes,
                week,
                courseInfo.day,
                courseInfo.sections[0].section,
                holidayReplacements
              ),
              duration: convertSectionLengthToDuration(
                courseInfo.sections.length,
                courseInfo.sections[0].section
              ),
              title: courseInfo.name,
              location: courseInfo.position,
              description: courseInfo.teacher,
              calName: `${termName} (${name})`,
              alarms: [
                {
                  action: 'display',
                  description: '课前二十分钟提醒',
                  trigger: { minutes: 20, before: true },
                },
              ],
            } as ics.EventAttributes;
          }) as ics.EventAttributes[];
      }
    );

    const events = weekEvents.flat();

    const { error, value } = ics.createEvents(events);
    if (error || !value) {
      reject(error);
    }
    resolve({
      events: events,
      ics: value!,
    });
  });
}

interface UserLimit {
  onlyInfosLastCall: number;
  infosToCalendarLastCall: number;
}

const app = express();
app.use(express.json());
app.post('/', async (req, res) => {
  const { username, password, termId, termStart } = req.body;
  if (!username || !password || !termStart) {
    res.status(400).send('Bad Request');
    return;
  }
  try {
    console.log('Generating Calendar for', username);
    const { sectionTimes, courseInfos, termName, name } = await GetCourseInfos({
      username,
      password,
      termId,
    });
    const { ics: calendar } = await generateCalendar(
      courseInfos,
      sectionTimes,
      termStart,
      termName,
      name,
      HolidayReplacement
    );
    res.header('Content-Type', 'text/calendar');
    res.send(calendar);
    console.log('Calendar Generated');
  } catch (e) {
    console.log(e);
    res.status(500).send(e);
  }
});
app.post('/onlyInfos', async (req, res) => {
  const { username, password, termId, termStart } = req.body;
  if (!username || !password || !termStart) {
    res.status(400).json({
      code: -1,
      msg: 'Bad Request',
    });
    return;
  }
  console.log('POST /onlyinfos', username);

  fs.mkdirSync('./dist/limit', { recursive: true });
  if (!fs.existsSync(`./dist/limit/${username}.json`)) {
    fs.writeFileSync(
      `./dist/limit/${username}.json`,
      JSON.stringify({
        onlyInfosLastCall: 0,
        infosToCalendarLastCall: 0,
      } as UserLimit)
    );
  }
  const userLimit = JSON.parse(
    fs.readFileSync(`./dist/limit/${username}.json`).toString()
  ) as UserLimit;
  const onlyInfosLastCall = userLimit.onlyInfosLastCall;
  userLimit.onlyInfosLastCall = new Date().getTime();
  fs.writeFileSync(`./dist/limit/${username}.json`, JSON.stringify(userLimit));
  if (new Date().getTime() - onlyInfosLastCall < 1000 * 60) {
    console.log('Too Many Requests', username);
    res.status(429).json({
      code: -1,
      msg: 'Too Many Requests',
    });
    return;
  }

  console.log('Generating CourseInfos for', username);

  getCourseInfos(username, password, termId)
    .then(({ sectionTimes, courseInfos, termName, name }) => {
      console.log('Course Info generated');
      res.json({
        code: 0,
        sectionTimes,
        courseInfos,
        termName,
        name,
      });
    })
    .catch((e) => {
      console.log('error', e);
      res.status(500).json({
        code: -1,
        msg: e.message || e,
      });
    });
});
app.post('/infosToCalendar', async (req, res) => {
  const {
    courseInfos,
    sectionTimes,
    termStart,
    termName,
    name,
    termId,
    shuId,
    holidayReplacement,
    previousCalendar,
  } = req.body;
  if (
    !courseInfos ||
    !sectionTimes ||
    !termStart ||
    !termName ||
    !name ||
    !shuId ||
    !termId
  ) {
    res.status(400).json({
      code: -1,
      msg: 'Bad Request',
    });
    return;
  }
  if (previousCalendar && !previousCalendar.endsWith('.ics')) {
    res.status(400).json({
      code: -1,
      msg: 'Bad Request',
    });
    return;
  }
  console.log('POST /infosToCalendar', shuId, name);

  fs.mkdirSync('./dist/limit', { recursive: true });
  if (!fs.existsSync(`./dist/limit/${shuId}.json`)) {
    fs.writeFileSync(
      `./dist/limit/${shuId}.json`,
      JSON.stringify({
        onlyInfosLastCall: 0,
        infosToCalendarLastCall: 0,
      } as UserLimit)
    );
  }
  const userLimit = JSON.parse(
    fs.readFileSync(`./dist/limit/${shuId}.json`).toString()
  ) as UserLimit;
  const infosToCalendarLastCall = userLimit.infosToCalendarLastCall;
  userLimit.infosToCalendarLastCall = new Date().getTime();
  fs.writeFileSync(`./dist/limit/${shuId}.json`, JSON.stringify(userLimit));
  if (new Date().getTime() - infosToCalendarLastCall < 1000 * 60) {
    console.log('Too Many Requests', shuId);
    res.status(429).json({
      code: -1,
      msg: 'Too Many Requests',
    });
    return;
  }

  console.log('Generating Calendar for', shuId, name);

  generateCalendar(
    courseInfos,
    sectionTimes,
    termStart,
    termName,
    name,
    holidayReplacement || []
  )
    .then((calendar) => {
      console.log('Calendar Generated, Uploading...');
      const fileName = `${shuId}/${previousCalendar || randomFilename()}`;
      UploadFile(fileName, Buffer.from(calendar.ics))
        .then((r) => {
          console.log('Calendar Uploaded', fileName);
          res.json({
            code: 0,
            url: `https://calendar-subscription.shuhole.cn/${fileName}`,
            usePrevious: !!previousCalendar,
          });
          if (previousCalendar) {
            RefreshCdn(`https://calendar-subscription.shuhole.cn/${fileName}`)
              .then((r) => {
                console.log('CDN Refreshed', fileName);
              })
              .catch((e) => {
                console.log('CDN Refresh Failed', e);
              });
          }
          UploadFile(
            'source/' + fileName,
            Buffer.from(JSON.stringify(req.body))
          )
            .then((r) => {
              console.log('Source Uploaded', fileName);
              RefreshCdn(
                `https://calendar-subscription.shuhole.cn/source/${fileName}`
              )
                .then((r) => {
                  console.log('Source File CDN Refreshed', fileName);
                })
                .catch((e) => {
                  console.log('Source File CDN Refresh Failed', e);
                });
            })
            .catch((e) => {
              console.log('Source Upload Failed', e);
            });
        })
        .catch((e) => {
          console.log('Upload Failed', e);
          res.status(500).json({
            code: -1,
            msg: e.message || e,
          });
        });
    })
    .catch((e) => {
      console.log('error', e);
      res.status(500).json({
        code: -1,
        msg: e.message || e,
      });
    });
});
app.get('/termsList', async (req, res) => {
  getAllTerms()
    .then((r) => {
      res.json(r);
    })
    .catch((e) => {
      res.status(500).send(e);
    });
});
app.get('/replacement', (req, res) => {
  res.json(HolidayReplacement);
});
app.listen(33134, () => {
  console.log('Server started on http://localhost:33134');
});
