import '../config';

// Wikipedia REST API — 100% free, no API key needed
const WIKI_API = 'https://es.wikipedia.org/api/rest_v1';
const WIKI_ACTION_API = 'https://es.wikipedia.org/w/api.php';

interface WikiSearchResult {
  title: string;
  description: string;
  extract?: string;
}

interface WikiArticle {
  title: string;
  summary: string;
  sections: string[];
  images: WikiImage[];
  url: string;
}

interface WikiImage {
  url: string;
  description: string;
  width: number;
  height: number;
}

export class WikipediaService {

  /**
   * Search Wikipedia for articles related to a topic
   */
  static async searchArticles(topic: string, limit = 5): Promise<WikiSearchResult[]> {
    const url = `${WIKI_ACTION_API}?action=query&list=search&srsearch=${encodeURIComponent(topic)}&srlimit=${limit}&format=json&origin=*`;
    
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`Wikipedia search ${res.status}`);
      
      const data = await res.json() as any;
      const results: WikiSearchResult[] = (data.query?.search || []).map((r: any) => ({
        title: r.title,
        description: r.snippet?.replace(/<[^>]+>/g, '') || '', // strip HTML
        extract: undefined,
      }));

      console.log(`[Wikipedia] 🔍 Found ${results.length} articles for "${topic}"`);
      return results;
    } catch (err: any) {
      console.warn(`[Wikipedia] ⚠ Search failed: ${err.message}`);
      return [];
    }
  }

  /**
   * Get article summary + key content from Wikipedia REST API
   */
  static async getArticleSummary(title: string): Promise<WikiArticle | null> {
    try {
      // Get summary via REST API
      const summaryUrl = `${WIKI_API}/page/summary/${encodeURIComponent(title)}`;
      const res = await fetch(summaryUrl, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return null;
      
      const data = await res.json() as any;
      
      // Get full article sections for more content
      const sectionsUrl = `${WIKI_ACTION_API}?action=parse&page=${encodeURIComponent(title)}&prop=sections|images&format=json&origin=*`;
      const secRes = await fetch(sectionsUrl, { signal: AbortSignal.timeout(10000) });
      const secData = secRes.ok ? await secRes.json() as any : null;
      
      const sections = secData?.parse?.sections?.map((s: any) => s.line).filter(Boolean) || [];
      
      // Get images from the article
      const images = await this.getArticleImages(title);

      return {
        title: data.title,
        summary: data.extract || '',
        sections,
        images,
        url: data.content_urls?.desktop?.page || `https://es.wikipedia.org/wiki/${encodeURIComponent(title)}`,
      };
    } catch (err: any) {
      console.warn(`[Wikipedia] ⚠ Summary failed for "${title}": ${err.message}`);
      return null;
    }
  }

  /**
   * Get images from a Wikipedia article (public domain / CC)
   */
  static async getArticleImages(title: string, limit = 5): Promise<WikiImage[]> {
    try {
      const url = `${WIKI_ACTION_API}?action=query&titles=${encodeURIComponent(title)}&prop=images&imlimit=${limit * 2}&format=json&origin=*`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return [];

      const data = await res.json() as any;
      const pages = data.query?.pages || {};
      const pageData = Object.values(pages)[0] as any;
      const imageNames: string[] = (pageData?.images || [])
        .map((img: any) => img.title)
        .filter((t: string) => 
          // Filter out icons, logos, commons stuff
          !t.includes('Commons-logo') && 
          !t.includes('Icon') && 
          !t.includes('.svg') &&
          !t.includes('Flag_of')
        )
        .slice(0, limit);
      
      if (imageNames.length === 0) return [];
      
      // Get actual image URLs
      const imageInfoUrl = `${WIKI_ACTION_API}?action=query&titles=${imageNames.join('|')}&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=1920&format=json&origin=*`;
      const infoRes = await fetch(imageInfoUrl, { signal: AbortSignal.timeout(10000) });
      if (!infoRes.ok) return [];
      
      const infoData = await infoRes.json() as any;
      const infoPages = infoData.query?.pages || {};
      
      const images: WikiImage[] = [];
      for (const page of Object.values(infoPages) as any[]) {
        const info = page.imageinfo?.[0];
        if (!info || !info.url) continue;
        // Use thumbnail URL if available (better size), fallback to full
        const imgUrl = info.thumburl || info.url;
        if (imgUrl.endsWith('.svg') || imgUrl.endsWith('.ogg')) continue;
        
        images.push({
          url: imgUrl,
          description: info.extmetadata?.ImageDescription?.value?.replace(/<[^>]+>/g, '') || page.title || '',
          width: info.thumbwidth || info.width,
          height: info.thumbheight || info.height,
        });
      }

      console.log(`[Wikipedia] 🖼 Found ${images.length} images for "${title}"`);
      return images;
    } catch (err: any) {
      console.warn(`[Wikipedia] ⚠ Images failed for "${title}": ${err.message}`);
      return [];
    }
  }

  /**
   * Full pipeline: search → get best article → return formatted context for LLM
   */
  static async getContextForTopic(topic: string): Promise<string | undefined> {
    // Search for relevant articles
    const results = await this.searchArticles(topic, 3);
    if (results.length === 0) return undefined;

    // Get summary of top 2 articles
    const articles: WikiArticle[] = [];
    for (const result of results.slice(0, 2)) {
      const article = await this.getArticleSummary(result.title);
      if (article && article.summary.length > 50) {
        articles.push(article);
      }
    }

    if (articles.length === 0) return undefined;

    // Format for LLM prompt
    let context = '';
    for (const article of articles) {
      context += `📖 WIKIPEDIA: "${article.title}"\n`;
      context += `URL: ${article.url}\n`;
      context += `${article.summary}\n`;
      if (article.sections.length > 0) {
        context += `Secciones: ${article.sections.slice(0, 8).join(', ')}\n`;
      }
      if (article.images.length > 0) {
        context += `Imágenes disponibles: ${article.images.length}\n`;
        article.images.forEach((img, i) => {
          context += `  - Imagen ${i + 1}: ${img.description.slice(0, 100)}\n`;
        });
      }
      context += '\n';
    }

    console.log(`[Wikipedia] ✅ Context ready: ${articles.length} articles, ${context.length} chars`);
    return context;
  }

  /**
   * Get image URLs from Wikipedia for use in video scenes
   */
  static async getImagesForTopic(topic: string): Promise<WikiImage[]> {
    const results = await this.searchArticles(topic, 2);
    const allImages: WikiImage[] = [];

    for (const result of results.slice(0, 2)) {
      const images = await this.getArticleImages(result.title, 3);
      allImages.push(...images);
    }

    return allImages.slice(0, 5); // Max 5 images
  }
}
