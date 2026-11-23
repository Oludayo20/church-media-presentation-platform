import { migrate } from "../migrate";
import { migrations } from "../migrations.generated";
import { openDatabase, type Database } from "../client";

export async function openMigratedMemoryDb(): Promise<Database> {
  const database = openDatabase({ path: ":memory:" });
  await migrate(database.sqlite, migrations);
  return database;
}
