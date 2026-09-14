// Creates collections and brings indexes in line with the Mongoose schemas.
// MongoDB replacement for "apply migrations": run after pulling schema changes.
//   npm run db:sync
import "dotenv/config";

import { connectDb, disconnectDb } from "@/lib/db/connection";
import { allModels } from "@/lib/db/models";

async function main() {
  const { connection } = await connectDb();
  console.log(`Connected to database "${connection.name}"`);
  for (const model of allModels) {
    await model.createCollection();
    const dropped = await model.syncIndexes();
    const indexes = await model.listIndexes();
    console.log(
      `  ${model.collection.collectionName}: ${indexes.length} indexes` +
        (dropped.length ? ` (dropped stale: ${dropped.join(", ")})` : ""),
    );
  }
}

main()
  .then(() => disconnectDb())
  .catch(async (error: unknown) => {
    console.error("db:sync failed:", error instanceof Error ? error.message : error);
    await disconnectDb();
    process.exit(1);
  });
