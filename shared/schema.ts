import { pgTable, text, serial, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const leads = pgTable("leads", {
  id: serial("id").primaryKey(),
  platform: text("platform").notNull(), // 'instagram' | 'linkedin'
  username: text("username").notNull(),
  profileUrl: text("profile_url"),
  followerCount: integer("follower_count"),
  bio: text("bio"),
  email: text("email"),
  isQualified: boolean("is_qualified").default(false),
  relevanceScore: integer("relevance_score").default(0),
  queryUsed: text("query_used").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  metadata: jsonb("metadata"), // For any extra scraped data
});

export const insertLeadSchema = createInsertSchema(leads).omit({ 
  id: true, 
  createdAt: true 
});

export type Lead = typeof leads.$inferSelect;
export type InsertLead = z.infer<typeof insertLeadSchema>;

export const scrapeRequestSchema = z.object({
  platform: z.enum(["instagram", "linkedin", "both"]),
  query: z.string().min(1, "Search query is required"),
  quantity: z.number().min(1).max(100).default(10),
  offering: z.string().min(1, "Offering description is required"),
});

export type ScrapeRequest = z.infer<typeof scrapeRequestSchema>;
