import Parser from 'rss-parser';

// 1. Extend the Parser types so TypeScript stops complaining
type CustomItem = { 
    author?: string; 
    creator?: string; 
    mediaContent?: { $: { url: string } };
    mediaThumbnail?: { $: { url: string } };
    itemImage?: { url: string };
    contentEncoded?: string;
};
type CustomFeed = {};

const parser: Parser<CustomFeed, CustomItem> = new Parser({
    timeout: 5000,
    headers: { 'User-Agent': 'FeedBar-Server/1.0 (+https://feedbar.app)' },
    customFields: {
        item: [
            ['media:content', 'mediaContent'],
            ['media:thumbnail', 'mediaThumbnail'],
            ['image', 'itemImage'],
            ['content:encoded', 'contentEncoded'],
            ['author', 'author'] // Ensure author is explicitly mapped
        ],
    }
});

export interface CleanItem {
    title: string;
    url: string;
    published_at: Date;
    author: string | null;
    summary: string | null;
    image_url: string | null;
}

export async function fetchFeed(url: string): Promise<CleanItem[] | null> {
    try {
        const feed = await parser.parseURL(url);
        
        return feed.items.map(item => {
            // Logic for image extraction
            let image = item.enclosure?.url || null;
            if (!image && item.mediaContent) image = item.mediaContent.$.url;
            if (!image && item.mediaThumbnail) image = item.mediaThumbnail.$.url;
            if (!image && item.itemImage) image = item.itemImage.url;

            return {
                title: item.title || 'Untitled',
                url: item.link || '',
                published_at: item.isoDate ? new Date(item.isoDate) : new Date(),
                // Now TypeScript knows these might exist
                author: item.creator || item.author || null,
                summary: item.contentSnippet || item.content || item.contentEncoded || null,
                image_url: image
            };
        }).filter(i => i.url !== '');
    } catch (e) {
        console.error(`RSS Fail [${url}]:`, e);
        return null;
    }
}