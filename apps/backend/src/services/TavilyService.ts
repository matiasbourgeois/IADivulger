/**
 * TavilyService — Búsqueda web con datos reales antes de llamar al LLM
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * Busca información actualizada en dominios oficiales para que Claude
 * tenga datos reales y verifiquecables en lugar de inventarlos.
 *
 * Dominios permitidos (configurables):
 *   IA Global:   openai.com, anthropic.com, deepmind.com, arxiv.org,
 *                huggingface.co, blogs.microsoft.com, nvidia.com
 *   IA Argentina: infobae.com, lanacion.com.ar, clarín.com, telam.com.ar
 *   Datos:        statista.com, ourworldindata.org, datos.gob.ar
 */

import '../config';

const TAVILY_API_URL = 'https://api.tavily.com/search';

export interface TavilyResult {
  title: string;
  url: string;
  content: string;  // extracto relevante
  score: number;    // relevancia 0-1
  publishedDate?: string;
}

export interface TavilySearchResponse {
  results: TavilyResult[];
  query: string;
  searchedAt: string;
}

// ─── Dominios permitidos por categoría ────────────────────────────────────────

const ALLOWED_DOMAINS_AI_GLOBAL = [
  'openai.com',
  'anthropic.com',
  'deepmind.google',
  'arxiv.org',
  'huggingface.co',
  'blogs.microsoft.com',
  'nvidia.com',
  'mistral.ai',
  'ai.meta.com',
  'blog.google',
];

const ALLOWED_DOMAINS_AI_LATAM = [
  'infobae.com',
  'lanacion.com.ar',
  'clarin.com',
  'telam.com.ar',
  'datos.gob.ar',
  'indec.gob.ar',
];

const ALLOWED_DOMAINS_DATA = [
  'statista.com',
  'ourworldindata.org',
  'idc.com',
  'gartner.com',
];

export const ALL_ALLOWED_DOMAINS = [
  ...ALLOWED_DOMAINS_AI_GLOBAL,
  ...ALLOWED_DOMAINS_AI_LATAM,
  ...ALLOWED_DOMAINS_DATA,
];

// ─── Main service ─────────────────────────────────────────────────────────────

export class TavilyService {
  private static readonly apiKey = process.env.TAVILY_API_KEY;

  /**
   * Busca información real sobre un tema antes de pasarlo al LLM.
   * Genera 2-3 queries relacionadas y combina los resultados más relevantes.
   *
   * @param topic  Tema del video (ej: "ChatGPT en Argentina 2025")
   * @param maxResults  Número máximo de resultados totales (default: 8)
   * @returns Array de resultados ordenados por relevancia
   */
  static async searchForTopic(
    topic: string,
    maxResults: number = 8
  ): Promise<TavilySearchResponse> {
    if (!this.apiKey) {
      console.warn('[Tavily] TAVILY_API_KEY no configurada — saltando búsqueda web');
      return { results: [], query: topic, searchedAt: new Date().toISOString() };
    }

    // Generar queries complementarias para cubrir distintos ángulos
    const queries = this.buildQueries(topic);
    console.log(`[Tavily] Buscando "${topic}" con ${queries.length} queries`);

    const allResults: TavilyResult[] = [];

    for (const query of queries) {
      try {
        const results = await this.singleSearch(query, Math.ceil(maxResults / queries.length));
        allResults.push(...results);
      } catch (err: any) {
        console.warn(`[Tavily] Query fallida: "${query}" — ${err.message}`);
      }
    }

    // Deduplicar por URL y ordenar por score
    const seen = new Set<string>();
    const unique = allResults
      .filter(r => {
        if (seen.has(r.url)) return false;
        seen.add(r.url);
        return true;
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);

    console.log(`[Tavily] ✅ ${unique.length} resultados únicos para "${topic}"`);
    return {
      results: unique,
      query: topic,
      searchedAt: new Date().toISOString(),
    };
  }

  /**
   * Formatea los resultados de Tavily para inyectarlos en el prompt del LLM.
   * Genera un bloque de texto estructurado con fuentes y extractos.
   */
  static formatForPrompt(searchResponse: TavilySearchResponse): string {
    if (searchResponse.results.length === 0) {
      return '(No se encontraron datos web para este tema. Usá tu conocimiento base.)';
    }

    const lines = ['=== DATOS REALES ENCONTRADOS EN LA WEB ==='];
    lines.push(`Búsqueda: "${searchResponse.query}" | ${new Date(searchResponse.searchedAt).toLocaleDateString('es-AR')}`);
    lines.push('');

    searchResponse.results.forEach((r, i) => {
      lines.push(`[Fuente ${i + 1}] ${r.title}`);
      lines.push(`URL: ${r.url}`);
      if (r.publishedDate) lines.push(`Fecha: ${r.publishedDate}`);
      lines.push(`Extracto: ${r.content.slice(0, 400).trim()}...`);
      lines.push('');
    });

    lines.push('=== USÁ ESTOS DATOS EN EL SCRIPT. CITÁ LA FUENTE CON SU URL EN sourceUrls. ===');

    return lines.join('\n');
  }

  /**
   * Extrae las URLs más relevantes para incluir como sourceUrls en las escenas.
   */
  static extractTopUrls(searchResponse: TavilySearchResponse, limit: number = 3): string[] {
    return searchResponse.results.slice(0, limit).map(r => r.url);
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private static buildQueries(topic: string): string[] {
    // Generar 2-3 queries complementarias
    const base = topic;
    const queries = [
      base,
      `${base} estadísticas datos 2025 2026`,
    ];

    // Si el tema parece ser sobre IA, agregar query específica de Argentina
    if (/ia|inteligencia artificial|llm|gpt|claude|ai/i.test(topic)) {
      queries.push(`${base} Argentina Latinoamerica`);
    }

    return queries.slice(0, 3);
  }

  private static async singleSearch(query: string, maxResults: number): Promise<TavilyResult[]> {
    const response = await fetch(TAVILY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        query,
        search_depth: 'advanced',
        max_results: maxResults,
        include_answer: false,
        include_raw_content: false,
        include_domains: ALL_ALLOWED_DOMAINS,
      }),
      signal: AbortSignal.timeout(10000), // 10s timeout por query
    });

    if (!response.ok) {
      throw new Error(`Tavily API ${response.status}: ${await response.text()}`);
    }

    const data = await response.json() as { results: any[] };
    return (data.results || []).map((r: any) => ({
      title: r.title || '',
      url: r.url || '',
      content: r.content || r.snippet || '',
      score: r.score || 0,
      publishedDate: r.published_date,
    }));
  }
}
