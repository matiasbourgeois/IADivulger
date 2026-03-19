import '../config';
import path from 'path';
import fs from 'fs';

// Pexels API — 100% free, no attribution required, commercial use allowed
const PEXELS_API = 'https://api.pexels.com/v1';

interface PexelsPhoto {
  id: number;
  url: string;         // Pexels page URL
  photographer: string;
  src: {
    original: string;
    large2x: string;   // 1880px wide
    large: string;     // 940px wide
    medium: string;    // 350px wide
  };
  alt: string;
  width: number;
  height: number;
}

interface PexelsSearchResult {
  photos: PexelsPhoto[];
  total_results: number;
}

export class PexelsService {
  private static apiKey = process.env.PEXELS_API_KEY || '';

  /**
   * Search Pexels for photos related to a query
   */
  static async searchPhotos(query: string, perPage = 5): Promise<PexelsPhoto[]> {
    if (!this.apiKey) {
      console.warn('[Pexels] ⚠ No API key configured');
      return [];
    }

    try {
      const url = `${PEXELS_API}/search?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=landscape&size=large`;
      const res = await fetch(url, {
        headers: { Authorization: this.apiKey },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Pexels ${res.status}: ${err.slice(0, 100)}`);
      }

      const data = await res.json() as PexelsSearchResult;
      console.log(`[Pexels] 🔍 Found ${data.total_results} photos for "${query}" (returning ${data.photos.length})`);
      
      return data.photos;
    } catch (err: any) {
      console.warn(`[Pexels] ⚠ Search failed: ${err.message}`);
      return [];
    }
  }

  /**
   * Download a photo to the local assets directory for use in video
   */
  static async downloadPhoto(photo: PexelsPhoto, outputDir: string, filename: string): Promise<string | null> {
    try {
      // Use large2x quality (1880px wide — good for 1080p video)
      const imageUrl = photo.src.large2x || photo.src.large || photo.src.original;
      
      const res = await fetch(imageUrl, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);

      const buffer = Buffer.from(await res.arrayBuffer());
      
      // Ensure output directory exists
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      const ext = '.jpg';
      const filePath = path.join(outputDir, `${filename}${ext}`);
      fs.writeFileSync(filePath, buffer);

      console.log(`[Pexels] ✅ Downloaded "${photo.alt.slice(0, 50)}" → ${filePath} (${(buffer.length / 1024).toFixed(0)}KB)`);
      return filePath;
    } catch (err: any) {
      console.warn(`[Pexels] ⚠ Download failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Full pipeline: search → pick best photos → return metadata for LLM/pipeline
   */
  static async getPhotosForTopic(topic: string, count = 4): Promise<{
    photos: PexelsPhoto[];
    searchQuery: string;
  }> {
    // Convert topic to a good search query (English works better on Pexels)
    const searchQuery = this.topicToSearchQuery(topic);
    const photos = await this.searchPhotos(searchQuery, count);
    
    return { photos, searchQuery };
  }

  /**
   * Convert a Spanish topic to an English search query for better Pexels results
   */
  private static topicToSearchQuery(topic: string): string {
    // Simple translations for common Spanish words
    const translations: Record<string, string> = {
      'telescopio': 'telescope',
      'espacio': 'space',
      'calentamiento global': 'global warming',
      'energía solar': 'solar energy',
      'inteligencia artificial': 'artificial intelligence',
      'cambio climático': 'climate change',
      'agujeros negros': 'black holes',
      'tecnología': 'technology',
      'ciencia': 'science',
      'drones': 'drones',
      'robótica': 'robotics',
      'futuro': 'future',
      'medicina': 'medicine',
      'descubrimientos': 'discoveries',
    };

    let query = topic.toLowerCase();
    for (const [es, en] of Object.entries(translations)) {
      query = query.replace(es, en);
    }
    
    // Remove common Spanish filler words
    query = query
      .replace(/\b(los|las|del|de|la|el|un|una|sobre|como|para|que|en|por|con|más|últimos?)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    return query || topic;
  }

  /**
   * Format photo info for the LLM prompt context
   */
  static formatForPrompt(photos: PexelsPhoto[]): string {
    if (photos.length === 0) return '';
    
    let context = `🖼 FOTOS REALES DISPONIBLES (Pexels — uso libre, sin atribución):\n`;
    photos.forEach((p, i) => {
      context += `  Foto ${i + 1}: "${p.alt || 'Sin descripción'}" (${p.width}×${p.height}) — ID: ${p.id}\n`;
      context += `    URL: ${p.src.large2x}\n`;
    });
    context += `\nPodés usar estas fotos reales en escenas tipo "web_image" en vez de generar con IA.\n`;
    context += `Para usarlas, poné el campo "webImageUrl" con la URL de la foto.\n`;
    
    return context;
  }
}
