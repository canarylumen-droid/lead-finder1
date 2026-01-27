import { useState, useRef, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { scrapeRequestSchema, type ScrapeRequest, type LogEntry } from "@shared/schema";
import { useLeads, useScrapeLeads, useStats, getExportUrl, useJobWebSocket } from "@/hooks/use-leads";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LeadCard } from "@/components/LeadCard";
import { StatsCard } from "@/components/StatsCard";
import { Loader2, Search, Download, Target, Users, BarChart3, Sparkles, Terminal, Copy, CheckCircle, XCircle, AlertCircle, Info, ChevronLeft, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from "@/components/ThemeToggle";

function LogLine({ log }: { log: LogEntry }) {
  const getIcon = () => {
    switch (log.level) {
      case 'success': return <CheckCircle className="w-3 h-3 text-green-500" />;
      case 'error': return <XCircle className="w-3 h-3 text-red-500" />;
      case 'warn': return <AlertCircle className="w-3 h-3 text-amber-500" />;
      default: return <Info className="w-3 h-3 text-blue-500" />;
    }
  };

  const getColor = () => {
    switch (log.level) {
      case 'success': return 'text-green-400';
      case 'error': return 'text-red-400';
      case 'warn': return 'text-amber-400';
      default: return 'text-gray-300';
    }
  };

  return (
    <div className="flex items-start gap-2 text-xs font-mono py-0.5">
      <span className="text-gray-500 shrink-0">
        {log.workerId !== undefined ? `[W${log.workerId}]` : '[SYS]'}
      </span>
      {getIcon()}
      <span className={getColor()}>{log.message}</span>
    </div>
  );
}

export default function Dashboard() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<'all' | 'qualified' | 'unqualified'>("all");
  const [page, setPage] = useState(1);
  const [currentJobId, setCurrentJobId] = useState<number | null>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  
  const { data: leadsData, isLoading: isLoadingLeads } = useLeads(page, 20, activeTab);
  const { data: stats, isLoading: isLoadingStats } = useStats();
  const scrapeMutation = useScrapeLeads();
  const { logs, stats: jobStats, isComplete } = useJobWebSocket(currentJobId);

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs]);

  const form = useForm<ScrapeRequest>({
    resolver: zodResolver(scrapeRequestSchema),
    defaultValues: {
      platform: "instagram",
      query: "",
      quantity: 50,
      offering: "",
    },
  });

  const onSubmit = (data: ScrapeRequest) => {
    scrapeMutation.mutate(data, {
      onSuccess: (response) => {
        if (response.jobId) {
          setCurrentJobId(parseInt(response.jobId));
          toast({
            title: "Job Started",
            description: response.message,
          });
        }
      },
      onError: (error) => {
        toast({
          title: "Error",
          description: error.message,
          variant: "destructive",
        });
      },
    });
  };

  const copyLogs = () => {
    const logText = logs.map(l => `[${l.workerId !== undefined ? `W${l.workerId}` : 'SYS'}] ${l.message}`).join('\n');
    navigator.clipboard.writeText(logText);
    toast({ title: "Logs copied to clipboard" });
  };

  const leads = leadsData?.leads || [];
  const totalPages = leadsData?.totalPages || 1;

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 pb-20">
      {/* Header */}
      <div className="bg-background border-b border-border/40 sticky top-0 z-10 backdrop-blur-md bg-background/80 supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="bg-primary/10 p-2 rounded-xl text-primary">
                <Target className="w-6 h-6" />
              </div>
              <h1 className="text-xl font-bold font-display bg-clip-text text-transparent bg-gradient-to-r from-primary to-violet-600">
                LeadGen Pro
              </h1>
            </div>
            <div className="flex items-center gap-4">
              <ThemeToggle />
              <Button variant="outline" size="sm" className="hidden sm:flex" asChild>
                <a href={getExportUrl()} target="_blank" rel="noopener noreferrer">
                  <Download className="w-4 h-4 mr-2" />
                  Export CSV
                </a>
              </Button>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        
        {/* Stats Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <StatsCard
            title="Total Leads"
            value={isLoadingStats ? "..." : (stats?.total ?? 0)}
            description="Leads found across platforms"
            icon={Users}
            trend="neutral"
          />
          <StatsCard
            title="Qualified Leads"
            value={isLoadingStats ? "..." : (stats?.qualified ?? 0)}
            description="AI-verified matches"
            icon={Target}
            trend="up"
          />
          <StatsCard
            title="Avg. Relevance"
            value={isLoadingStats ? "..." : `${stats?.averageScore ?? 0}%`}
            description="Overall match quality"
            icon={BarChart3}
            trend="up"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Search/Config Panel */}
          <div className="lg:col-span-4 space-y-6">
            <Card className="border-border/50 shadow-lg shadow-primary/5 overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary via-violet-500 to-primary opacity-20" />
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-primary" />
                  New Search
                </CardTitle>
                <CardDescription>
                  Define your target audience and we'll find qualified leads.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                    
                    <FormField
                      control={form.control}
                      name="offering"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Your Offering</FormLabel>
                          <FormControl>
                            <Textarea 
                              placeholder="e.g. We provide SEO services for dental clinics..." 
                              className="resize-none min-h-[80px] bg-muted/30 focus:bg-background transition-colors"
                              {...field} 
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="platform"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Platform</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                              <FormControl>
                                <SelectTrigger className="bg-muted/30" data-testid="select-platform">
                                  <SelectValue placeholder="Select platform" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="instagram">Instagram</SelectItem>
                                <SelectItem value="linkedin">LinkedIn</SelectItem>
                                <SelectItem value="both">Both</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="quantity"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Quantity</FormLabel>
                            <Select 
                              onValueChange={(val) => field.onChange(parseInt(val))} 
                              defaultValue={String(field.value)}
                            >
                              <FormControl>
                                <SelectTrigger className="bg-muted/30" data-testid="select-quantity">
                                  <SelectValue placeholder="Amount" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="50">50 Leads</SelectItem>
                                <SelectItem value="100">100 Leads</SelectItem>
                                <SelectItem value="250">250 Leads</SelectItem>
                                <SelectItem value="500">500 Leads</SelectItem>
                                <SelectItem value="1000">1000 Leads</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="query"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Search Query</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                              <Input 
                                placeholder="e.g. Dentists in New York" 
                                className="pl-9 bg-muted/30 focus:bg-background transition-colors"
                                data-testid="input-query"
                                {...field} 
                              />
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <Button 
                      type="submit" 
                      className="w-full bg-gradient-to-r from-primary to-violet-600 hover:from-primary/90 hover:to-violet-600/90 shadow-lg shadow-primary/25"
                      disabled={scrapeMutation.isPending}
                      data-testid="button-submit"
                    >
                      {scrapeMutation.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Starting...
                        </>
                      ) : (
                        "Start Hunting"
                      )}
                    </Button>
                  </form>
                </Form>
              </CardContent>
            </Card>

            {/* Terminal Log Panel */}
            {currentJobId && (
              <Card className="border-border/50 overflow-hidden">
                <CardHeader className="py-3 px-4 flex flex-row items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-primary" />
                    <span className="font-medium text-sm">Live Logs</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {jobStats && (
                      <div className="flex items-center gap-3 text-xs">
                        <span className="text-green-500">{jobStats.processedCount} found</span>
                        <span className="text-amber-500">{jobStats.duplicatesSkipped} dupes</span>
                        <span className="text-blue-500">{jobStats.activeWorkers}/{jobStats.totalWorkers} workers</span>
                      </div>
                    )}
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={copyLogs} data-testid="button-copy-logs">
                      <Copy className="w-3 h-3" />
                    </Button>
                  </div>
                </CardHeader>
                <div 
                  ref={terminalRef}
                  className="bg-gray-900 dark:bg-gray-950 p-3 h-64 overflow-y-auto"
                >
                  {logs.length === 0 ? (
                    <div className="text-gray-500 text-xs font-mono">Waiting for logs...</div>
                  ) : (
                    logs.map((log, i) => <LogLine key={i} log={log} />)
                  )}
                  {isComplete && (
                    <div className="text-green-400 text-xs font-mono mt-2 pt-2 border-t border-gray-700">
                      Job completed successfully.
                    </div>
                  )}
                </div>
              </Card>
            )}
          </div>

          {/* Results Panel */}
          <div className="lg:col-span-8">
            <div className="flex flex-col h-full space-y-6">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <h2 className="text-2xl font-bold font-display">Leads</h2>
                <Tabs defaultValue="all" value={activeTab} onValueChange={(v) => { setActiveTab(v as any); setPage(1); }} className="w-auto">
                  <TabsList className="bg-muted/50">
                    <TabsTrigger value="all" data-testid="tab-all">All ({leadsData?.total || 0})</TabsTrigger>
                    <TabsTrigger value="qualified" data-testid="tab-qualified">Qualified</TabsTrigger>
                    <TabsTrigger value="unqualified" data-testid="tab-unqualified">Low Match</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              {isLoadingLeads ? (
                <div className="flex-1 flex flex-col items-center justify-center min-h-[400px] text-muted-foreground">
                  <Loader2 className="h-12 w-12 animate-spin mb-4 text-primary/50" />
                  <p>Fetching your leads...</p>
                </div>
              ) : !leads?.length ? (
                <div className="flex-1 flex flex-col items-center justify-center min-h-[400px] bg-muted/20 rounded-xl border border-dashed border-border p-12 text-center">
                  <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                    <Search className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <h3 className="text-lg font-medium">No leads found yet</h3>
                  <p className="text-muted-foreground max-w-sm mt-2">
                    Start a new search to find potential leads matching your criteria.
                  </p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 auto-rows-fr">
                    <AnimatePresence mode="popLayout">
                      {leads.map((lead, index) => (
                        <LeadCard key={lead.id} lead={lead} index={index} />
                      ))}
                    </AnimatePresence>
                  </div>
                  
                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div className="flex items-center justify-center gap-2 pt-4">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page === 1}
                        data-testid="button-prev-page"
                      >
                        <ChevronLeft className="w-4 h-4" />
                        Previous
                      </Button>
                      <span className="text-sm text-muted-foreground px-4">
                        Page {page} of {totalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={page === totalPages}
                        data-testid="button-next-page"
                      >
                        Next
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
