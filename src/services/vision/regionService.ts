import { GeminiVisionService } from './geminiVision';
import { RegionDetectionResponse } from './types';
import { prisma } from '../../db/client';
import { Prisma } from '@prisma/client';

/**
 * Region Detection Service with Smart Caching
 * Only runs detection on first capture in a session, then reuses cached data
 */
export class RegionDetectionService {
  private visionService: GeminiVisionService;

  constructor(geminiApiKey: string) {
    this.visionService = new GeminiVisionService(geminiApiKey);
  }

  /**
   * Detect regions with smart caching
   * Returns cached data if available, otherwise performs new detection
   */
  async detectOrUseCache(
    sessionId: string,
    imageData: string,
    force: boolean = false
  ): Promise<{ regionData: RegionDetectionResponse; fromCache: boolean }> {
    console.log('[REGION_SERVICE] 🔍 Checking if region detection needed...');

    // Check if session has cached data and skipRegionDetection flag
    const session = await prisma.chatSession.findUnique({
      where: { id: sessionId },
      select: { cachedRegionData: true, skipRegionDetection: true },
    });

    if (!force && session?.skipRegionDetection && session?.cachedRegionData) {
      console.log('[REGION_SERVICE] ✅ Using cached region data (smart cache hit)');
      console.log('[REGION_SERVICE] 💰 Saved ~$0.00075 and ~2-3 seconds');
      return {
        regionData: session.cachedRegionData as unknown as RegionDetectionResponse,
        fromCache: true,
      };
    }

    // No cache or forced detection - run vision analysis
    console.log('[REGION_SERVICE] 🔄 Running NEW region detection...');
    console.log('[REGION_SERVICE] 💰 Cost: ~$0.00075, Time: ~2-3 seconds');

    const regionData = await this.visionService.detectRegions(imageData);

    // Cache the results and enable skip flag for future captures
    console.log('[REGION_SERVICE] 💾 Caching region data for future use...');
    await prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        cachedRegionData: regionData as unknown as Prisma.InputJsonValue,
        skipRegionDetection: true, // Enable cache for next capture
      },
    });

    console.log('[REGION_SERVICE] ✅ Region detection complete and cached');
    return {
      regionData,
      fromCache: false,
    };
  }

  /**
   * Invalidate cache (user clicked "Detect Questions Again" button)
   */
  async invalidateCache(sessionId: string): Promise<void> {
    console.log('[REGION_SERVICE] 🗑️  Invalidating region cache...');
    await prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        cachedRegionData: Prisma.DbNull,
        skipRegionDetection: false,
      },
    });
    console.log('[REGION_SERVICE] ✅ Cache invalidated');
  }

  /**
   * Should we run region detection?
   * Returns true if imageData exists AND it's a new capture (not text follow-up)
   */
  static shouldDetectRegions(imageData?: string, isNewCapture: boolean = true): boolean {
    if (!imageData) {
      console.log('[REGION_SERVICE] ⏭️  Skipping region detection: no image');
      return false;
    }

    if (!isNewCapture) {
      console.log('[REGION_SERVICE] ⏭️  Skipping region detection: text follow-up');
      return false;
    }

    console.log('[REGION_SERVICE] ✅ Should run region detection: new capture with image');
    return true;
  }
}
