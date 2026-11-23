import path from "path";
import fs from "fs";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

function getR2Config() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME || "rushwash";
  const publicUrl = process.env.R2_PUBLIC_URL || "";
  const isR2Configured = Boolean(accountId && accessKeyId && secretAccessKey);
  return { accountId, accessKeyId, secretAccessKey, bucketName, publicUrl, isR2Configured };
}

let _r2Client: S3Client | null = null;
export function getR2Client(): S3Client | null {
  const { accountId, accessKeyId, secretAccessKey, isR2Configured } = getR2Config();
  if (!isR2Configured) return null;
  if (!_r2Client) {
    _r2Client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: accessKeyId!,
        secretAccessKey: secretAccessKey!,
      },
    });
  }
  return _r2Client;
}

// Local uploads directory fallback
const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

export async function uploadFile(
  fileBuffer: Buffer,
  originalFilename: string,
  mimeType: string,
  prefix: string = "complaints"
): Promise<string> {
  const { bucketName, publicUrl } = getR2Config();
  const client = getR2Client();
  const timestamp = Date.now();
  const safeName = originalFilename.replace(/[^a-zA-Z0-9.-]/g, "_");
  const key = `${prefix}/${timestamp}-${safeName}`;

  if (client) {
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: key,
          Body: fileBuffer,
          ContentType: mimeType,
        })
      );

      if (publicUrl) {
        return `${publicUrl.replace(/\/$/, "")}/${key}`;
      }
      return `/api/files/${key}`;
    } catch (err) {
      console.warn("R2 upload error, falling back to local storage:", err);
    }
  }

  // Local disk fallback
  const subDir = path.join(uploadsDir, prefix);
  if (!fs.existsSync(subDir)) {
    fs.mkdirSync(subDir, { recursive: true });
  }

  const localFileName = `${timestamp}-${safeName}`;
  const localFilePath = path.join(subDir, localFileName);
  await fs.promises.writeFile(localFilePath, fileBuffer);

  return `/uploads/${prefix}/${localFileName}`;
}

export async function getFileFromR2(key: string) {
  const client = getR2Client();
  const { bucketName } = getR2Config();
  if (!client) return null;
  try {
    return await client.send(
      new GetObjectCommand({
        Bucket: bucketName,
        Key: key,
      })
    );
  } catch (err) {
    return null;
  }
}
