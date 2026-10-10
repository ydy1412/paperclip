import { pgTable, uuid, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { folders } from "./folders.js";

export const artifactFolderEntries = pgTable("artifact_folder_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(()=>companies.id,{onDelete:"cascade"}),
  artifactId: text("artifact_id").notNull(),
  folderId: uuid("folder_id").notNull().references(()=>folders.id,{onDelete:"cascade"}),
  updatedAt: timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
},table=>({companyArtifact:uniqueIndex("artifact_folder_entries_company_artifact_idx").on(table.companyId,table.artifactId),companyFolder:index("artifact_folder_entries_company_folder_idx").on(table.companyId,table.folderId)}));
