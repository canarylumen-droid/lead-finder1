import { z } from 'zod';
import { leads, scrapeRequestSchema } from './schema';

export const api = {
  leads: {
    list: {
      method: 'GET' as const,
      path: '/api/leads',
      responses: {
        200: z.array(z.custom<typeof leads.$inferSelect>()),
      },
    },
    scrape: {
      method: 'POST' as const,
      path: '/api/scrape',
      input: scrapeRequestSchema,
      responses: {
        200: z.object({
          message: z.string(),
          jobId: z.string().optional(), // If async
          leads: z.array(z.custom<typeof leads.$inferSelect>()),
        }),
      },
    },
    export: {
      method: 'GET' as const,
      path: '/api/leads/export',
      responses: {
        200: z.any(), // CSV blob
      },
    },
    stats: {
      method: 'GET' as const,
      path: '/api/stats',
      responses: {
        200: z.object({
          totalScraped: z.number(),
          qualifiedLeads: z.number(),
          averageScore: z.number(),
        }),
      },
    }
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
