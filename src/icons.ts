import axios from 'axios';
import * as cheerio from 'cheerio';

export async function getBestIcon(siteUrl: string): Promise<string | null> {
    try {
        const domain = new URL(siteUrl).origin;
        
        // 1. Fetch the HTML with a 5s timeout and a real User-Agent
        const response = await axios.get(domain, {
            timeout: 5000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) FeedBar/1.0' }
        });

        const $ = cheerio.load(response.data);
        let iconUrl: string | null = null;

        // 2. Prioritize Apple Touch Icon (your high-res preference)
        const appleIcon = $('link[rel="apple-touch-icon"]').attr('href') || 
                          $('link[rel="apple-touch-icon-precomposed"]').attr('href');
        
        if (appleIcon) iconUrl = appleIcon;

        // 3. Fallback to shortcut icon / icon
        if (!iconUrl) {
            iconUrl = $('link[rel="icon"]').attr('href') || 
                      $('link[rel="shortcut icon"]').attr('href');
        }

        // 4. Resolve relative URLs (e.g., "/favicon.png" -> "https://site.com/favicon.png")
        if (iconUrl) {
            if (iconUrl.startsWith('//')) {
                iconUrl = 'https:' + iconUrl;
            } else if (iconUrl.startsWith('/')) {
                iconUrl = domain + iconUrl;
            } else if (!iconUrl.startsWith('http')) {
                iconUrl = domain + '/' + iconUrl;
            }
            return iconUrl;
        }

        // 5. Final Fallback: The standard root favicon
        return `${domain}/favicon.ico`;
    } catch (error) {
        console.error(`Icon scraper failed for ${siteUrl}:`, error);
        // If the site blocks scraping, still return the root favicon guess
        try {
            return `${new URL(siteUrl).origin}/favicon.ico`;
        } catch {
            return null;
        }
    }
}