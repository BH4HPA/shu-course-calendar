import RSA from 'node-rsa';
import CreateClient from './client';
import { logChain, moduleLog } from './logger';

let client = CreateClient('https://oauth.shu.edu.cn/', 'OAUTH');

function encryptShuPassword(source: string) {
  const rsa = new RSA(
    `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDl/aCgRl9f/4ON9MewoVnV58OL
OU2ALBi2FKc5yIsfSpivKxe7A6FitJjHva3WpM7gvVOinMehp6if2UNIkbaN+plW
f5IwqEVxsNZpeixc4GsbY9dXEk3WtRjwGSyDLySzEESH/kpJVoxO7ijRYqU+2oSR
wTBNePOk1H+LRQokgQIDAQAB
-----END PUBLIC KEY-----`,
    'pkcs8-public-pem',
    {
      encryptionScheme: 'pkcs1',
    }
  );
  return rsa.encrypt(source, 'base64');
}

export function fetchCallbackUrl(
  SHUSTUID: string,
  SHUSTUPWD: string,
  config: {
    clientId: string;
    redirectUri: string;
  }
): Promise<string> {
  moduleLog('OAUTH', 'Start Login..');
  return new Promise((resolve, reject) => {
    client({
      url: `/oauth/authorize?response_type=code&client_id=${encodeURIComponent(
        config.clientId
      )}&redirect_uri=${encodeURIComponent(config.redirectUri)}&scope=1`,
      method: 'GET',
      maxRedirects: 0,
      validateStatus: (s) => s === 302,
    })
      .then((res) => {
        const location: string = res.headers.location;
        if (location.startsWith(config.redirectUri)) {
          moduleLog('OAUTH', 'Already Logged in.');
          resolve(location);
        } else
          client({
            url: location,
            method: 'GET',
            maxRedirects: 0,
            validateStatus: (s: number) => s === 200,
          })
            .then(() => {
              client({
                url: location,
                method: 'POST',
                maxRedirects: 0,
                validateStatus: (s) => s === 302,
                data: `username=${SHUSTUID}&password=${encodeURIComponent(
                  encryptShuPassword(SHUSTUPWD)
                )}`,
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded',
                },
              })
                .then((res) => {
                  const location = res.headers.location;
                  client({
                    url: location,
                    method: 'GET',
                    maxRedirects: 0,
                    validateStatus: (s) => s === 302,
                  })
                    .then((res) => {
                      const location: string = res.headers.location;
                      if (location.startsWith(config.redirectUri)) {
                        moduleLog('OAUTH', logChain('Login Successfully'));
                        resolve(location);
                      } else {
                        moduleLog(
                          'OAUTH',
                          logChain('Login Failed', 'trying to clear cache')
                        );
                        logout().then(() => {
                          fetchCallbackUrl(SHUSTUID, SHUSTUPWD, config)
                            .then(resolve)
                            .catch(reject);
                        });
                      }
                    })
                    .catch(reject);
                })
                .catch(reject);
            })
            .catch(reject);
      })
      .catch(reject);
  });
}

export function logout() {
  return new Promise((resolve, reject) => {
    client('https://newsso.shu.edu.cn/oauth/logout')
      .then((r) => {
        client = CreateClient('https://oauth.shu.edu.cn/', 'OAUTH');
        resolve(r);
      })
      .catch(reject);
  });
}
