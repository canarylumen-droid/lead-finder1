import OpenAI from "openai";

// Standard OpenAI API - uses OPENAI_API_KEY from environment (Vercel compatible)
// Lazy initialization to prevent crashes when key isn't set
let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI | null {
  if (!openaiClient && process.env.OPENAI_API_KEY) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openaiClient;
}

interface ProfileData {
  platform: string;
  username: string;
  bio: string;
  name?: string;
  title?: string;
  company?: string;
  followerCount: number;
  email: string | null;
}

interface AnalysisResult {
  isQualified: boolean;
  relevanceScore: number;
  businessType: string;
  contextSummary: string;
  reasoning: string;
}

export async function analyzeProfileWithAI(
  profile: ProfileData,
  offering: string
): Promise<AnalysisResult> {
  try {
    const prompt = `Analyze this social media profile to determine if they are a good fit for our offering.

OFFERING: ${offering}

PROFILE:
- Platform: ${profile.platform}
- Username: ${profile.username}
- Name: ${profile.name || 'Unknown'}
- Title: ${profile.title || 'Unknown'}
- Company: ${profile.company || 'Unknown'}
- Followers: ${profile.followerCount}
- Bio: ${profile.bio || 'No bio'}
- Has Email: ${profile.email ? 'Yes' : 'No'}

Based on this profile, provide:
1. Business Type: Categorize as one of: agency, coach, consultant, fitness, ecommerce, saas, influencer, local_business, or unknown
2. Is Qualified: Would this person likely benefit from and be able to afford the offering? (true/false)
3. Relevance Score: 0-100 based on how well they match the offering
4. Context Summary: A brief 1-2 sentence summary of who they are and why they might (or might not) be a good fit

Respond in JSON format:
{
  "businessType": "string",
  "isQualified": boolean,
  "relevanceScore": number,
  "contextSummary": "string",
  "reasoning": "string"
}`;

    const openai = getOpenAI();
    if (!openai) {
      console.log("OpenAI API key not configured - using fallback analysis");
      return fallbackAnalysis(profile, offering);
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a lead qualification expert. Analyze profiles and determine their fit for business offerings. Be concise and accurate."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 500,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from AI");
    }

    const result = JSON.parse(content) as AnalysisResult;
    
    return {
      isQualified: result.isQualified ?? false,
      relevanceScore: Math.min(100, Math.max(0, result.relevanceScore ?? 0)),
      businessType: result.businessType ?? 'unknown',
      contextSummary: result.contextSummary ?? '',
      reasoning: result.reasoning ?? '',
    };
  } catch (error: any) {
    console.error("AI analysis error:", error.message);
    
    // Fallback to basic scoring if AI fails
    return fallbackAnalysis(profile, offering);
  }
}

function fallbackAnalysis(profile: ProfileData, offering: string): AnalysisResult {
  const bio = (profile.bio || '').toLowerCase();
  const title = (profile.title || '').toLowerCase();
  
  // Basic keyword matching
  const agencyKeywords = ['agency', 'marketing', 'creative', 'digital', 'consulting', 'media'];
  const decisionMakerTitles = ['founder', 'ceo', 'owner', 'director', 'cmo', 'head', 'president'];
  
  let score = 0;
  let businessType = 'unknown';
  
  // Follower scoring
  if (profile.followerCount >= 50000) score += 25;
  else if (profile.followerCount >= 20000) score += 20;
  else if (profile.followerCount >= 10000) score += 15;
  else if (profile.followerCount >= 5000) score += 10;
  
  // Business type detection
  if (agencyKeywords.some(kw => bio.includes(kw))) {
    businessType = 'agency';
    score += 20;
  } else if (bio.includes('coach')) {
    businessType = 'coach';
    score += 15;
  } else if (bio.includes('consultant')) {
    businessType = 'consultant';
    score += 15;
  }
  
  // Decision maker bonus
  if (decisionMakerTitles.some(t => title.includes(t))) {
    score += 20;
  }
  
  // Email bonus
  if (profile.email) {
    score += 15;
  }
  
  const isQualified = score >= 50;
  
  return {
    isQualified,
    relevanceScore: Math.min(100, score),
    businessType,
    contextSummary: `${profile.name || profile.username} is a ${profile.title || 'professional'} at ${profile.company || 'their company'}.`,
    reasoning: 'Analyzed using keyword matching due to AI unavailability.',
  };
}
