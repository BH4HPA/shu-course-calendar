import COS from 'cos-nodejs-sdk-v5';

export function randomSeven(): string {
  return Math.random().toString(36).substring(2, 9);
}

export function UploadFile(filename: string, content: Buffer) {
  return new Promise((resolve, reject) => {
    const cos = new COS({
      SecretId: process.env.QCLOUD_SECRET_ID,
      SecretKey: process.env.QCLOUD_SECRET_KEY,
    });
    cos.putObject(
      {
        Bucket: process.env.QCLOUD_BUCKET!,
        Region: process.env.QCLOUD_REGION!,
        Key: filename,
        Body: content,
      },
      function (err, data) {
        if (err) {
          reject(err);
        }
        resolve(data);
      }
    );
  });
}
