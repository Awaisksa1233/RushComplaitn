import dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

const directUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
const prisma = new PrismaClient(directUrl ? { datasources: { db: { url: directUrl } } } : undefined);

async function main() {
  const sqlPath = path.resolve(process.cwd(), "prisma", "enable_rls.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  await prisma.$executeRawUnsafe(sql);

  const status = await prisma.$queryRawUnsafe<Array<{ tablename: string; rowsecurity: boolean }>>(
    `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;`
  );
  console.log("PostgreSQL public schema RLS status:");
  for (const row of status) {
    console.log(` - ${row.tablename}: rowsecurity=${row.rowsecurity}`);
  }
}

main()
  .catch((e) => {
    console.error("Failed to apply RLS:", e?.message || e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
