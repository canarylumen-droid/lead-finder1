import { db } from "./db";
import { leads, type InsertLead, type Lead } from "@shared/schema";
import { eq, desc } from "drizzle-orm";

export interface IStorage {
  createLead(lead: InsertLead): Promise<Lead>;
  getLeads(): Promise<Lead[]>;
  getLead(id: number): Promise<Lead | undefined>;
  getStats(): Promise<{ total: number; qualified: number }>;
}

export class DatabaseStorage implements IStorage {
  async createLead(insertLead: InsertLead): Promise<Lead> {
    const [lead] = await db.insert(leads).values(insertLead).returning();
    return lead;
  }

  async getLeads(): Promise<Lead[]> {
    return await db.select().from(leads).orderBy(desc(leads.createdAt));
  }

  async getLead(id: number): Promise<Lead | undefined> {
    const [lead] = await db.select().from(leads).where(eq(leads.id, id));
    return lead;
  }

  async getStats(): Promise<{ total: number; qualified: number }> {
    const allLeads = await db.select().from(leads);
    const qualified = allLeads.filter((l) => l.isQualified).length;
    return {
      total: allLeads.length,
      qualified,
    };
  }
}

export const storage = new DatabaseStorage();
