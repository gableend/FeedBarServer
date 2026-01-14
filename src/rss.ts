import Parser from 'rss-parser';
import axios from 'axios';
import * as cheerio from 'cheerio';

// ... (keep your existing CustomItem types and parser config) ...

async function getOGImage(url: string): Promise<string | null> {
    try {
        const { data } = await axios.get(url, { 
            timeout: 3000, // Stay fast! 
            headers: { 'User-Agent': 'FeedBar-Server/1.0' } 
        });
        const $ = cheerio.load(data);
        return $('meta[property="og:image"]').attr('content') || 
               $('meta[name="twitter:image"]').attr('content') || 
               null;
    } catch {
        return null;
    }
}

export async function fetchFeed(url: string): Promise<CleanItem[] | null> {
    try {
        const feed = await parser.parseURL(url);
        
        // Use a loop to handle potential async OG fetching
        const cleanedItems: CleanItem[] = [];

        for (const item of feed.items) {
            let image = item.enclosure?.url || null;
            if (!image && item.mediaContent) image = item.mediaContent.$.url;
            if (!image && item.mediaThumbnail) image = item.mediaThumbnail.$.url;
            
            // --- THE NEW LOGIC ---
            // If still no image, try the "Deep Lane" scraper
            if (!image && item.link) {
                // Note: This adds latency. We only do this if strictly necessary.
                image = await getOGImage(item.link);
            }

            cleanedItems.push({
                title: item.title || 'Untitled',
                url: item.link || '',
                published_at: item.isoDate ? new Date(item.isoDate) : new Date(),
                author: item.creator || item.author || null,
                summary: item.contentSnippet || item.content || item.contentEncoded || null,
                image_url: image
            });
        }
        
        return cleanedItems.filter(i => i.url !== '');
    } catch (e) {
        console.error(`RSS Fail [${url}]:`, e);
        return null;
    }
}