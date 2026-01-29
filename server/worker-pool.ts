import { storage, generateDedupeHash } from "./storage";
import { analyzeProfileWithAI } from "./ai-analyzer";
import { scrapeInstagramProfiles, scrapeLinkedInProfiles, type ScrapedProfile, isValidFollowerCount } from "./scraper/real-scraper";
import type { InsertLead, JobStats, LogEntry } from "@shared/schema";
import { EventEmitter } from "events";
import pLimit from "p-limit";

class WorkerPool extends EventEmitter {
  private workers: Map<number, boolean> = new Map();
  private activeJobs: Map<number, { running: boolean; targetCount: number }> = new Map();
  private maxWorkers: number = 20;

  constructor(workerCount: number = 20) {
    super();
    this.maxWorkers = workerCount;
    for (let i = 0; i < workerCount; i++) {
      this.workers.set(i, false);
    }
  }

  private async emitLog(jobId: number, workerId: number | undefined, level: string, message: string, data?: any) {
    const log = await storage.addJobLog({
      jobId,
      workerId: workerId ?? null,
      level,
      message,
      data: data ?? null,
    });
    
    const logEntry: LogEntry = {
      id: log.id,
      jobId: log.jobId,
      workerId: log.workerId ?? undefined,
      level: log.level,
      message: log.message,
      data: log.data,
      timestamp: log.createdAt?.toISOString() || new Date().toISOString(),
    };
    
    this.emit('log', logEntry);
  }

  private async emitStats(jobId: number) {
    const job = await storage.getScrapeJob(jobId);
    if (job) {
      const stats: JobStats = {
        jobId: job.id,
        status: job.status,
        processedCount: job.processedCount || 0,
        qualifiedCount: job.qualifiedCount || 0,
        duplicatesSkipped: job.duplicatesSkipped || 0,
        activeWorkers: job.activeWorkers || 0,
        totalWorkers: job.totalWorkers || this.maxWorkers,
      };
      this.emit('stats', stats);
    }
  }

  async startJob(jobId: number, platform: string, keywords: string | string[], offering: string, quantity: number): Promise<void> {
    // Handle keywords as string or array
    const keywordList = Array.isArray(keywords) 
      ? keywords 
      : keywords.split(',').map(k => k.trim()).filter(k => k.length > 0);

    await storage.startScrapeJob(jobId);
    this.activeJobs.set(jobId, { running: true, targetCount: quantity });
    
    await this.emitLog(jobId, undefined, 'info', `Starting parallel scraping with ${this.maxWorkers} workers`);
    await this.emitLog(jobId, undefined, 'info', `Target: ${quantity} leads from ${platform}`);
    await this.emitLog(jobId, undefined, 'info', `Keywords: ${keywordList.join(', ')}`);
    
    await storage.updateScrapeJobProgress(jobId, { activeWorkers: this.maxWorkers });
    await this.emitStats(jobId);

    try {
      // Parallel scraping for both platforms
      const scrapeTasks: Promise<ScrapedProfile[]>[] = [];
      
      const onProgress = async (msg: string) => {
        await this.emitLog(jobId, Math.floor(Math.random() * this.maxWorkers), 'info', msg);
      };

      const igQuantity = platform === 'both' ? Math.ceil(quantity * 0.6) : (platform === 'instagram' ? quantity : 0);
      const liQuantity = platform === 'both' ? Math.ceil(quantity * 0.4) : (platform === 'linkedin' ? quantity : 0);

      if (igQuantity > 0) {
        await this.emitLog(jobId, 0, 'info', `Starting Instagram scraper (target: ${igQuantity})`);
        scrapeTasks.push(scrapeInstagramProfiles(keywordList, igQuantity, onProgress));
      }

      if (liQuantity > 0) {
        await this.emitLog(jobId, 1, 'info', `Starting LinkedIn scraper (target: ${liQuantity})`);
        scrapeTasks.push(scrapeLinkedInProfiles(keywordList, liQuantity, onProgress));
      }

      // Run scrapers in parallel
      const results = await Promise.all(scrapeTasks);
      const allProfiles = results.flat();

      await this.emitLog(jobId, undefined, 'info', `Scraped ${allProfiles.length} raw profiles. Analyzing in parallel...`);

      // Process profiles in parallel with concurrency limit
      const limit = pLimit(this.maxWorkers);
      let processedCount = 0;
      let qualifiedCount = 0;
      let duplicatesSkipped = 0;

      const processTasks = allProfiles.slice(0, quantity).map((profile, index) => 
        limit(async () => {
          const workerId = index % this.maxWorkers;
          
          // Check follower range
          if (!isValidFollowerCount(profile.followerCount)) {
            await this.emitLog(jobId, workerId, 'warn', `Skip: ${profile.username} - ${profile.followerCount} followers`);
            return null;
          }

          // Dedupe check
          const dedupeHash = generateDedupeHash(profile.email, profile.platform, profile.username);
          const isDuplicate = await storage.checkDuplicate(dedupeHash);
          if (isDuplicate) {
            duplicatesSkipped++;
            await this.emitLog(jobId, workerId, 'warn', `Dupe: ${profile.username}`);
            return null;
          }

          // AI Analysis
          await this.emitLog(jobId, workerId, 'info', `Analyzing: ${profile.name || profile.username}`);
          const analysis = await analyzeProfileWithAI({
            platform: profile.platform,
            username: profile.username,
            bio: profile.bio,
            name: profile.name,
            title: profile.title,
            company: profile.company,
            followerCount: profile.followerCount,
            email: profile.email,
          }, offering);

          // Skip freelancers
          if (analysis.businessType === 'freelancer' || analysis.relevanceScore < 30) {
            await this.emitLog(jobId, workerId, 'warn', `Skip: ${profile.username} - ${analysis.businessType}`);
            return null;
          }

          // Save lead
          const lead: InsertLead = {
            platform: profile.platform,
            username: profile.username,
            profileUrl: profile.profileUrl,
            followerCount: profile.followerCount,
            bio: profile.bio,
            email: profile.email,
            name: profile.name || null,
            title: profile.title || null,
            company: profile.company || null,
            companySize: null,
            businessType: analysis.businessType,
            contextSummary: analysis.contextSummary,
            isQualified: analysis.isQualified,
            relevanceScore: analysis.relevanceScore,
            queryUsed: keywordList.join(', '),
            jobId,
            dedupeHash,
            metadata: { analysis },
          };

          const saved = await storage.createLead(lead);
          if (saved) {
            processedCount++;
            if (analysis.isQualified) qualifiedCount++;

            await this.emitLog(
              jobId,
              workerId,
              analysis.isQualified ? 'success' : 'info',
              `${analysis.isQualified ? 'QUALIFIED' : 'Added'}: ${profile.name || profile.username} (${analysis.businessType}, ${analysis.relevanceScore}%)${profile.email ? ' +email' : ''}`,
              { email: profile.email }
            );
          }

          // Update progress every few leads
          if (processedCount % 5 === 0) {
            await storage.updateScrapeJobProgress(jobId, {
              processedCount,
              qualifiedCount,
              duplicatesSkipped,
            });
            await this.emitStats(jobId);
          }

          return saved;
        })
      );

      await Promise.all(processTasks);

      // Final progress update
      await storage.updateScrapeJobProgress(jobId, {
        processedCount,
        qualifiedCount,
        duplicatesSkipped,
      });

      await this.completeJob(jobId, processedCount, qualifiedCount, duplicatesSkipped);

    } catch (error: any) {
      await this.emitLog(jobId, undefined, 'error', `Job failed: ${error.message}`);
      await storage.updateScrapeJobStatus(jobId, 'failed');
    }
  }

  private async completeJob(jobId: number, processedCount: number, qualifiedCount: number, duplicatesSkipped: number) {
    this.activeJobs.delete(jobId);
    await storage.completeScrapeJob(jobId);
    await storage.updateScrapeJobProgress(jobId, { activeWorkers: 0 });
    
    await this.emitLog(
      jobId,
      undefined,
      'success',
      `Completed: ${processedCount} leads, ${qualifiedCount} qualified, ${duplicatesSkipped} dupes skipped`
    );
    await this.emitStats(jobId);
    this.emit('complete', jobId);
  }

  cancelJob(jobId: number) {
    const jobInfo = this.activeJobs.get(jobId);
    if (jobInfo) {
      jobInfo.running = false;
      this.activeJobs.delete(jobId);
    }
  }

  getActiveJobs(): number[] {
    return Array.from(this.activeJobs.keys());
  }
}

export const workerPool = new WorkerPool(20);
