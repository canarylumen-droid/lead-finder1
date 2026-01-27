import { storage, generateDedupeHash } from "./storage";
import { analyzeProfileWithAI } from "./ai-analyzer";
import type { InsertLead, JobStats, LogEntry } from "@shared/schema";
import { EventEmitter } from "events";

export interface WorkerTask {
  id: string;
  jobId: number;
  platform: string;
  target: string;
  offering: string;
}

export interface ScrapedProfile {
  platform: 'instagram' | 'linkedin';
  username: string;
  profileUrl: string;
  followerCount: number;
  bio: string;
  email: string | null;
  name?: string;
  title?: string;
  company?: string;
  companySize?: string;
}

class WorkerPool extends EventEmitter {
  private workers: Map<number, boolean> = new Map();
  private taskQueue: WorkerTask[] = [];
  private activeJobs: Map<number, { running: boolean; targetCount: number }> = new Map();
  private maxWorkers: number = 20;

  constructor(workerCount: number = 20) {
    super();
    this.maxWorkers = workerCount;
    for (let i = 0; i < workerCount; i++) {
      this.workers.set(i, false); // false = idle
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

  async startJob(jobId: number, platform: string, query: string, offering: string, quantity: number): Promise<void> {
    await storage.startScrapeJob(jobId);
    this.activeJobs.set(jobId, { running: true, targetCount: quantity });
    
    await this.emitLog(jobId, undefined, 'info', `Starting job with ${this.maxWorkers} workers`);
    await this.emitLog(jobId, undefined, 'info', `Target: ${quantity} leads from ${platform}`);
    await this.emitLog(jobId, undefined, 'info', `Query: "${query}"`);
    
    // Generate mock targets for demonstration
    // In production, this would be replaced with real target discovery
    const targets = this.generateTargets(platform, query, quantity);
    
    for (let i = 0; i < targets.length; i++) {
      this.taskQueue.push({
        id: `${jobId}-${i}`,
        jobId,
        platform: targets[i].platform,
        target: targets[i].target,
        offering,
      });
    }
    
    await this.emitLog(jobId, undefined, 'info', `Queued ${targets.length} targets for processing`);
    
    // Start processing
    this.processQueue();
  }

  private generateTargets(platform: string, query: string, count: number): { platform: string; target: string }[] {
    const targets: { platform: string; target: string }[] = [];
    const platforms = platform === 'both' ? ['instagram', 'linkedin'] : [platform];
    
    for (let i = 0; i < count; i++) {
      const p = platforms[i % platforms.length];
      targets.push({
        platform: p,
        target: `${query.replace(/\s+/g, '_').toLowerCase()}_${i + 1}`,
      });
    }
    
    return targets;
  }

  private async processQueue() {
    const availableWorkers = Array.from(this.workers.entries())
      .filter(([_, busy]) => !busy)
      .map(([id]) => id);
    
    for (const workerId of availableWorkers) {
      const task = this.taskQueue.shift();
      if (!task) break;
      
      const jobInfo = this.activeJobs.get(task.jobId);
      if (!jobInfo?.running) continue;
      
      this.workers.set(workerId, true);
      this.processTask(workerId, task);
    }
  }

  private async processTask(workerId: number, task: WorkerTask) {
    const { jobId, platform, target, offering } = task;
    
    try {
      // Update active workers count
      const currentJob = await storage.getScrapeJob(jobId);
      await storage.updateScrapeJobProgress(jobId, {
        activeWorkers: (currentJob?.activeWorkers || 0) + 1,
      });
      await this.emitStats(jobId);
      
      await this.emitLog(jobId, workerId, 'info', `Processing target: ${target}`);
      
      // Simulate profile discovery (in production, this would be real scraping)
      await this.delay(500 + Math.random() * 1000);
      
      const profile = await this.discoverProfile(platform, target);
      
      if (!profile) {
        await this.emitLog(jobId, workerId, 'warn', `No profile found for ${target}`);
      } else {
        // Generate dedupe hash
        const dedupeHash = generateDedupeHash(profile.email, profile.platform, profile.username);
        
        // Check for duplicate
        const isDuplicate = await storage.checkDuplicate(dedupeHash);
        
        if (isDuplicate) {
          await this.emitLog(jobId, workerId, 'warn', `Duplicate skipped: ${profile.email || profile.username}`);
          const job = await storage.getScrapeJob(jobId);
          await storage.updateScrapeJobProgress(jobId, {
            duplicatesSkipped: (job?.duplicatesSkipped || 0) + 1,
          });
        } else {
          // Analyze with AI
          const analysis = await analyzeProfileWithAI(profile, offering);
          
          const lead: InsertLead = {
            platform: profile.platform,
            username: profile.username,
            profileUrl: profile.profileUrl,
            followerCount: profile.followerCount,
            bio: profile.bio,
            email: profile.email,
            name: profile.name,
            title: profile.title,
            company: profile.company,
            companySize: profile.companySize,
            businessType: analysis.businessType,
            contextSummary: analysis.contextSummary,
            isQualified: analysis.isQualified,
            relevanceScore: analysis.relevanceScore,
            queryUsed: target,
            jobId,
            dedupeHash,
            metadata: { analysis },
          };
          
          const savedLead = await storage.createLead(lead);
          
          if (savedLead) {
            const job = await storage.getScrapeJob(jobId);
            await storage.updateScrapeJobProgress(jobId, {
              processedCount: (job?.processedCount || 0) + 1,
              qualifiedCount: analysis.isQualified ? (job?.qualifiedCount || 0) + 1 : job?.qualifiedCount || 0,
            });
            
            await this.emitLog(
              jobId, 
              workerId, 
              analysis.isQualified ? 'success' : 'info',
              `${analysis.isQualified ? 'Qualified' : 'Found'}: ${profile.name || profile.username} (${analysis.relevanceScore}%)`,
              { email: profile.email, businessType: analysis.businessType }
            );
          }
        }
      }
      
      await this.emitStats(jobId);
      
    } catch (error: any) {
      await this.emitLog(jobId, workerId, 'error', `Error: ${error.message}`);
    } finally {
      // Update active workers count
      const currentJob = await storage.getScrapeJob(jobId);
      await storage.updateScrapeJobProgress(jobId, {
        activeWorkers: Math.max((currentJob?.activeWorkers || 1) - 1, 0),
      });
      
      this.workers.set(workerId, false);
      
      // Check if job is complete
      const jobInfo = this.activeJobs.get(jobId);
      const remainingTasks = this.taskQueue.filter(t => t.jobId === jobId).length;
      const activeTasks = Array.from(this.workers.values()).filter(busy => busy).length;
      
      if (remainingTasks === 0 && activeTasks === 0 && jobInfo) {
        await this.completeJob(jobId);
      } else {
        // Process next task
        this.processQueue();
      }
    }
  }

  private async discoverProfile(platform: string, target: string): Promise<ScrapedProfile | null> {
    // Simulate profile discovery with realistic data
    // In production, this would use real scraping logic
    
    const businessTypes = ['agency', 'coach', 'consultant', 'fitness', 'ecommerce', 'saas'];
    const titles = ['CEO', 'Founder', 'Director', 'CMO', 'Marketing Head', 'Owner'];
    const companies = ['Digital Agency', 'Growth Partners', 'Creative Studio', 'Marketing Co', 'Brand Labs'];
    
    const randomBusiness = businessTypes[Math.floor(Math.random() * businessTypes.length)];
    const randomTitle = titles[Math.floor(Math.random() * titles.length)];
    const randomCompany = companies[Math.floor(Math.random() * companies.length)];
    
    const hasEmail = Math.random() > 0.3;
    const followerCount = Math.floor(5000 + Math.random() * 95000);
    
    return {
      platform: platform as 'instagram' | 'linkedin',
      username: target,
      profileUrl: platform === 'instagram' 
        ? `https://instagram.com/${target}`
        : `https://linkedin.com/in/${target}`,
      followerCount,
      bio: `${randomTitle} at ${randomCompany}. Helping businesses grow through ${randomBusiness} strategies.`,
      email: hasEmail ? `${target.toLowerCase().replace(/[^a-z0-9]/g, '')}@example.com` : null,
      name: target.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      title: randomTitle,
      company: randomCompany,
      companySize: ['1-10', '11-50', '51-200', '201-500'][Math.floor(Math.random() * 4)],
    };
  }

  private async completeJob(jobId: number) {
    const jobInfo = this.activeJobs.get(jobId);
    if (!jobInfo) return;
    
    this.activeJobs.delete(jobId);
    await storage.completeScrapeJob(jobId);
    
    const finalJob = await storage.getScrapeJob(jobId);
    await this.emitLog(
      jobId, 
      undefined, 
      'success',
      `Job completed: ${finalJob?.processedCount || 0} leads found, ${finalJob?.qualifiedCount || 0} qualified`
    );
    await this.emitStats(jobId);
    this.emit('complete', jobId);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  cancelJob(jobId: number) {
    const jobInfo = this.activeJobs.get(jobId);
    if (jobInfo) {
      jobInfo.running = false;
      this.taskQueue = this.taskQueue.filter(t => t.jobId !== jobId);
    }
  }

  getActiveJobs(): number[] {
    return Array.from(this.activeJobs.keys());
  }
}

export const workerPool = new WorkerPool(20);
