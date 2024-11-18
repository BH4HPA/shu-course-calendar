import { Agent } from 'https';
import fetch from 'node-fetch';
import 'dotenv/config';

import { fetchCallbackUrl, logout } from './login';
import { logChain, moduleLog } from './logger';
import { IElectiveBatch } from './type';
import {
  _getPeriods,
  _getSectionTimes,
  _toCourseInfos,
  CourseInfo,
  SectionTime,
} from './parser';

const SHUSTUID = process.env.SHUSTUID;
const SHUSTUPWD = process.env.SHUSTUPWD;
const OUTPUTDIR = process.env.OUTPUTDIR || 'interval-crawler-task-result';

if (!SHUSTUID || !SHUSTUPWD) {
  throw new Error('SHUSTUID or SHUSTUPWD not found');
}

const httpsAgent = new Agent({
  rejectUnauthorized: false,
});

function fetchBatch(
  token: string
): Promise<{ schoolTerm: string; name: string; code: string }[]> {
  return new Promise((resolve, reject) => {
    fetch(`https://jwxk.shu.edu.cn/xsxk/web/studentInfo`, {
      method: 'POST',
      headers: {
        Authorization: token,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `token=${token}`,
      agent: httpsAgent,
    })
      .then((r) => {
        r.json()
          .then((r: any) => {
            if (r.code !== 200) reject(r.msg);
            const raw_batches: {
              schoolTerm: string;
              name: string;
              code: string;
            }[] = (r.data.student.electiveBatchList as IElectiveBatch[])
              // .filter((e) => e.canSelect === '1')
              .map((e) => ({
                schoolTerm: e.schoolTerm,
                name: e.name,
                code: e.code,
              }))
              .sort((a, b) => {
                const convertTermToNumber = (term: string) => {
                  const [startYear, endYear, semester] = term.split('-');
                  return parseInt(startYear) * 10 + parseInt(semester);
                };
                return (
                  convertTermToNumber(b.schoolTerm) -
                  convertTermToNumber(a.schoolTerm)
                );
              });
            const batches_set = new Set<string>();
            const batches = raw_batches.filter((e) => {
              if (!batches_set.has(e.schoolTerm)) {
                batches_set.add(e.schoolTerm);
                return true;
              }
              return false;
            });
            moduleLog(
              'JWXK',
              logChain(
                '批次信息',
                '\n - ' +
                  batches
                    .map((e) => `${e.name}(${e.schoolTerm}) ${e.code}`)
                    .join('\n - ')
              )
            );
            resolve(batches);
          })
          .catch(reject);
      })
      .catch(reject);
  });
}

function getToken(
  username = SHUSTUID!,
  password = SHUSTUPWD!
): Promise<string> {
  return new Promise((resolve, reject) => {
    fetchCallbackUrl(username, password, {
      clientId: 'E422OBk2611Y4bUEO21gm1OF1RxkFLQ6',
      redirectUri: 'https://jwxk.shu.edu.cn/xsxk/oauth/callback',
    })
      .then((url) => {
        fetch(url, {
          agent: httpsAgent,
        })
          .then((r) => {
            const token = r.url.split('index.html?token=')[1];
            // moduleLog('JWXK', logChain('TOKEN', token));
            resolve(token);
          })
          .catch(reject);
      })
      .catch(reject);
  });
}

function fetchTermCourses(token: string, code: string): Promise<CourseInfo[]> {
  return new Promise((resolve, reject) => {
    fetch(
      `https://jwxk.shu.edu.cn/xsxk/elective/shu/grablessons?batchId=${code}`,
      {
        agent: httpsAgent,
        headers: {
          Cookie: `Authorization=${token}`,
        },
      }
    )
      .then(() =>
        fetch('https://jwxk.shu.edu.cn/xsxk/elective/shu/xskb', {
          method: 'POST',
          headers: {
            Authorization: token,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          agent: httpsAgent,
        })
          .then((r) => {
            r.json()
              .then((r: any) => {
                if (r.code === 200) {
                  const courseInfos: CourseInfo[] = [];
                  for (const e of r.data.yxkc) {
                    courseInfos.push(
                      ..._toCourseInfos(
                        e.KCM,
                        e.SKJS,
                        e.teachingPlaceHide || '',
                        _getPeriods(e.teachingPlace, '', false)
                      )
                    );
                  }
                  resolve(courseInfos);
                } else {
                  reject(r.msg);
                }
              })
              .catch(reject);
          })
          .catch(reject)
      )
      .catch(reject);
  });
}

function fetchStudentInfo(
  token: string,
  termCode: string
): Promise<{ termName: string; name: string }> {
  return new Promise((resolve, reject) => {
    fetch(`https://jwxk.shu.edu.cn/xsxk/web/studentInfo`, {
      method: 'POST',
      headers: {
        Authorization: token,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `token=${token}`,
      agent: httpsAgent,
    })
      .then((r) => {
        r.json()
          .then((r: any) => {
            if (r.code !== 200) reject(r.msg);
            const raw_batches: {
              schoolTerm: string;
              name: string;
              code: string;
            }[] = (r.data.student.electiveBatchList as IElectiveBatch[])
              // .filter((e) => e.canSelect === '1')
              .map((e) => ({
                schoolTerm: e.schoolTerm,
                name: e.name,
                code: e.code,
              }))
              .sort((a, b) => {
                const convertTermToNumber = (term: string) => {
                  const [startYear, endYear, semester] = term.split('-');
                  return parseInt(startYear) * 10 + parseInt(semester);
                };
                return (
                  convertTermToNumber(b.schoolTerm) -
                  convertTermToNumber(a.schoolTerm)
                );
              });
            const batches_set = new Set<string>();
            const batches = raw_batches.filter((e) => {
              if (!batches_set.has(e.schoolTerm)) {
                batches_set.add(e.schoolTerm);
                return true;
              }
              return false;
            });
            resolve({
              termName: batches.find((e) => e.code === termCode)!.name,
              name: r.data.student.XM,
            });
          })
          .catch(reject);
      })
      .catch(reject);
  });
}

export function getAllTerms(): Promise<
  {
    schoolTerm: string;
    name: string;
    code: string;
  }[]
> {
  return new Promise((resolve, reject) => {
    getToken()
      .then((token) => {
        fetchBatch(token)
          .then(async (batches) => {
            logout().then(() => {
              resolve(batches);
            });
          })
          .catch(reject);
      })
      .catch(reject);
  });
}

export function getCourseInfos(
  username: string,
  password: string,
  termCode: string
): Promise<{
  sectionTimes: SectionTime[];
  courseInfos: CourseInfo[];
  termName: string;
  name: string;
}> {
  return new Promise((resolve, reject) => {
    getToken(username, password)
      .then((token) => {
        fetchTermCourses(token, termCode)
          .then((courses) => {
            fetchStudentInfo(token, termCode).then(({ termName, name }) => {
              logout().then(() => {
                resolve({
                  sectionTimes: _getSectionTimes(),
                  courseInfos: courses,
                  termName: termName,
                  name: name,
                });
              });
            });
          })
          .catch(reject);
      })
      .catch(reject);
  });
}
