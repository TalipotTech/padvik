// AWS S3 client for file uploads
// TODO: Implement with @aws-sdk/client-s3

export const S3_CONFIG = {
  bucket: process.env.AWS_S3_BUCKET || "padvik-uploads",
  region: process.env.AWS_REGION || "ap-south-1",
} as const;
