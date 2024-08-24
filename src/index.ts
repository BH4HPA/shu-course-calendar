import prompts from 'prompts';
import * as ics from 'ics';
import * as fs from 'fs';
import express from 'express';

import { GetCourseInfos, GetTermList } from './browser';

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
  startSection: number
) {
  const startTime = new Date(termStart);
  startTime.setDate(startTime.getDate() + (week - 1) * 7 + day - 1);
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
  return `${endTime.getFullYear().toString().padStart(4, '0')}${(
    endTime.getMonth() + 1
  )
    .toString()
    .padStart(2, '0')}${endTime.getDate().toString().padStart(2, '0')}T000000Z`;
}

function generateCalendar(
  courseInfos: CourseInfo[],
  sectionTimes: SectionTime[],
  termStartDate: Date,
  termName: string,
  name: string
): Promise<{
  events: ics.EventAttributes[];
  ics: string;
}> {
  return new Promise((resolve, reject) => {
    const weekEvents: ics.EventAttributes[][] = courseInfos.map(
      (courseInfo) => {
        const weekPatternMode = getWeekPatternMode(courseInfo.weekPattern);
        if (weekPatternMode === 'odd-even' || weekPatternMode === 'continuous')
          return [
            {
              start: computeStartTime(
                termStartDate,
                sectionTimes,
                courseInfo.weeks[0],
                courseInfo.day,
                courseInfo.sections[0].section
              ),
              duration: convertSectionLengthToDuration(
                courseInfo.sections.length,
                courseInfo.sections[0].section
              ),
              recurrenceRule: `FREQ=WEEKLY;INTERVAL=${
                weekPatternMode === 'odd-even' ? '2' : '1'
              };UNTIL=${computeCourseEndTime(
                termStartDate,
                courseInfo.weeks[courseInfo.weeks.length - 1]
              )}`,
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
            } as ics.EventAttributes,
          ];
        // weekPatternMode === 'other'
        return courseInfo.weeks.map((week) => {
          return {
            start: computeStartTime(
              termStartDate,
              sectionTimes,
              week,
              courseInfo.day,
              courseInfo.sections[0].section
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
      name
    );
    res.header('Content-Type', 'text/calendar');
    res.send(calendar);
    console.log('Calendar Generated');
  } catch (e) {
    console.log(e);
    res.status(500).send(e);
  }
});
app.get('/termsList', async (req, res) => {
  try {
    const { terms } = await GetTermList();
    res.send(terms);
  } catch (e) {
    console.log(e);
    res.status(500).send(e);
  }
});
app.listen(9000, () => {
  console.log('Server started on http://localhost:9000');
});
