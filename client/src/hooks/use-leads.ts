import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";
import type { ScrapeRequest, Lead, JobStats, LogEntry } from "@shared/schema";
import { useState, useEffect, useCallback, useRef } from "react";

interface PaginatedLeads {
  leads: Lead[];
  total: number;
  page: number;
  totalPages: number;
}

// GET /api/leads with pagination
export function useLeads(page: number = 1, limit: number = 20, qualified: 'all' | 'qualified' | 'unqualified' = 'all') {
  return useQuery<PaginatedLeads>({
    queryKey: [api.leads.list.path, page, limit, qualified],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        qualified,
      });
      const res = await fetch(`${api.leads.list.path}?${params}`);
      if (!res.ok) throw new Error("Failed to fetch leads");
      return res.json();
    },
  });
}

// POST /api/scrape
export function useScrapeLeads() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: ScrapeRequest) => {
      const res = await fetch(api.leads.scrape.path, {
        method: api.leads.scrape.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      
      if (!res.ok) throw new Error("Failed to start scraping job");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.leads.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.leads.stats.path] });
    },
  });
}

// GET /api/stats
export function useStats() {
  return useQuery({
    queryKey: [api.leads.stats.path],
    queryFn: async () => {
      const res = await fetch(api.leads.stats.path);
      if (!res.ok) throw new Error("Failed to fetch stats");
      return res.json() as Promise<{ total: number; qualified: number; averageScore: number }>;
    },
  });
}

// Export URL helper
export const getExportUrl = () => api.leads.export.path;

// WebSocket hook for real-time job updates
export function useJobWebSocket(jobId: number | null) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [stats, setStats] = useState<JobStats | null>(null);
  const [isComplete, setIsComplete] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const queryClient = useQueryClient();

  const connect = useCallback((id: number) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'subscribe', jobId: id }));
    };
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'log') {
          setLogs(prev => [...prev, data.data]);
        } else if (data.type === 'stats') {
          setStats(data.data);
        } else if (data.type === 'complete') {
          setIsComplete(true);
          queryClient.invalidateQueries({ queryKey: [api.leads.list.path] });
          queryClient.invalidateQueries({ queryKey: [api.leads.stats.path] });
        }
      } catch (e) {
        console.error('WebSocket message error:', e);
      }
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
    
    wsRef.current = ws;
  }, [queryClient]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    setLogs([]);
    setStats(null);
    setIsComplete(false);
  }, []);

  useEffect(() => {
    if (jobId) {
      reset();
      connect(jobId);
    }
    return () => disconnect();
  }, [jobId, connect, disconnect, reset]);

  return { logs, stats, isComplete, reset };
}

// Get job details
export function useJob(jobId: number | null) {
  return useQuery({
    queryKey: ['/api/jobs', jobId],
    queryFn: async () => {
      if (!jobId) return null;
      const res = await fetch(`/api/jobs/${jobId}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!jobId,
  });
}
