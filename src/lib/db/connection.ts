import mongoose from "mongoose";

import { getServerEnv } from "@/lib/env";

export const DEFAULT_DATABASE_NAME = "passcode";

const globalForMongoose = globalThis as unknown as {
  mongooseConnection?: Promise<typeof mongoose>;
};

// Never let Mongoose build queries from fields that aren't in the schema.
mongoose.set("strictQuery", true);

/**
 * Connects once per process and reuses the connection (including across
 * Next.js dev hot reloads). Safe to call from every request handler.
 */
export function connectDb(): Promise<typeof mongoose> {
  if (!globalForMongoose.mongooseConnection) {
    const env = getServerEnv();
    globalForMongoose.mongooseConnection = mongoose
      .connect(env.DATABASE_URL, {
        dbName: env.DATABASE_NAME ?? DEFAULT_DATABASE_NAME,
        // Indexes are managed explicitly via `npm run db:sync`, not on boot.
        autoIndex: false,
        serverSelectionTimeoutMS: 10_000,
      })
      .catch((error: unknown) => {
        globalForMongoose.mongooseConnection = undefined;
        throw error;
      });
  }
  return globalForMongoose.mongooseConnection;
}

export async function disconnectDb(): Promise<void> {
  if (!globalForMongoose.mongooseConnection) return;
  globalForMongoose.mongooseConnection = undefined;
  await mongoose.disconnect();
}
