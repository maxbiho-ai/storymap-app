import "server-only";
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { serverEnv } from "./env";

let client: S3Client | null = null;

/** Cloudflare R2 תואם S3 */
function r2(): S3Client {
  if (client) return client;
  client = new S3Client({
    region: "auto",
    // R2_ENDPOINT: optional, e.g. https://<account>.eu.r2.cloudflarestorage.com for EU buckets
    endpoint: process.env.R2_ENDPOINT || `https://${serverEnv.r2AccountId()}.r2.cloudflarestorage.com`,
    forcePathStyle: Boolean(process.env.R2_ENDPOINT),
    credentials: {
      accessKeyId: serverEnv.r2AccessKeyId(),
      secretAccessKey: serverEnv.r2SecretAccessKey(),
    },
  });
  return client;
}

export function r2PublicUrl(key: string): string {
  return `${serverEnv.r2PublicUrl()}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export async function r2Put(key: string, body: Buffer, contentType = "image/jpeg"): Promise<void> {
  await r2().send(
    new PutObjectCommand({
      Bucket: serverEnv.r2Bucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable", // מפתח ייחודי לכל קובץ
    }),
  );
}

/** מוחק מפתחות מפורשים + כל מה שתחת ה-prefix (תופס גם קבצים יתומים) */
export async function r2DeleteAll(keys: string[], prefix?: string): Promise<number> {
  const bucket = serverEnv.r2Bucket();
  const all = new Set(keys.filter(Boolean));

  if (prefix) {
    let token: string | undefined;
    do {
      const page = await r2().send(
        new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
      );
      page.Contents?.forEach((o) => o.Key && all.add(o.Key));
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  }

  const list = [...all];
  for (let i = 0; i < list.length; i += 1000) {
    const chunk = list.slice(i, i + 1000);
    await r2().send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
      }),
    );
  }
  return list.length;
}
