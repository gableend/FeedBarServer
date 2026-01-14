import Parser from 'rss-parser';
import axios from 'axios';
import * as cheerio from 'cheerio';

// 1. Define the types for the Parser and our Output
type CustomItem = { 
    author?: string; 
    creator?: string; 
    mediaContent?: { $: { url: string } };
    mediaThumbnail?: { $: { url: string } };
    itemImage?: { url: string };
    contentEncoded?: string;
};
type CustomFeed = {};

export interface CleanItem {
    title: string;
    url: string;
    published_at: Date;
    author: string | null;
    summary: string | null;
    image_url: string | null;
}

// 2. Instantiate the Parser with Custom Fields
const parser: Parser<CustomFeed, CustomItem> = new Parser({
    timeout: 5000,
    headers: { 'User-Agent': 'FeedBar-Server/1.0 (+https://feedbar.app)' },
    customFields: {
        item: [
            ['media:content', 'mediaContent'],
            ['media:thumbnail', 'mediaThumbnail'],
            ['image', 'itemImage'],
            ['content:encoded', 'contentEncoded'],
            ['author', 'author']
        ],
    }
});

// 3. The OG Image Scraper
async function getOGImage(url: string): Promise<string | null> {
    try {
        const { data } = await axios.get(url, { 
            timeout: 3000, 
            headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' } 
        });
        const $ = cheerio.load(data);
        return $('meta[property="og:image"]').attr('content') || 
               $('meta[name="twitter:image"]').attr('content') || 
               null;
    } catch {
        return null;
    }
}

// 4. The Main Fetch Function
export async function fetchFeed(url: string): Promise<CleanItem[] | null> {
    try {
        const feed = await parser.parseURL(url);
        const cleanedItems: CleanItem[] = [];

        for (const item of feed.items) {
            // Priority 1: RSS Tags
            let image = item.enclosure?.url || null;
            if (!image && item.mediaContent) image = item.mediaContent.$.url;
            if (!image && item.mediaThumbnail) image = item.mediaThumbnail.$.url;
            if (!image && item.itemImage) image = item.itemImage.url;

            // Priority 2: OG Scraper (Only if URL is missing)
            if (!image && item.link) {
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