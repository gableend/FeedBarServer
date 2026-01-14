import Parser from 'rss-parser';

const parser = new Parser({
    timeout: 5000,
    headers: { 'User-Agent': 'FeedBar-Server/1.0 (+https://feedbar.app)' },
    // This is the crucial part: manually mapping non-standard RSS tags
    customFields: {
        item: [
            ['media:content', 'mediaContent'],
            ['media:thumbnail', 'mediaThumbnail'],
            ['image', 'itemImage'],
            ['content:encoded', 'contentEncoded']
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
            // 1. Better Image Discovery Logic
            let image = item.enclosure?.url || null;
            
            // If no enclosure, check Media RSS (BBC/CNN style)
            if (!image && (item as any).mediaContent) {
                image = (item as any).mediaContent.$.url;
            }
            
            // Check for thumbnails
            if (!image && (item as any).mediaThumbnail) {
                image = (item as any).mediaThumbnail.$.url;
            }

            // Check for direct image tag
            if (!image && (item as any).itemImage) {
                image = (item as any).itemImage.url;
            }

            return {
                title: item.title || 'Untitled',
                url: item.link || '',
                published_at: item.isoDate ? new Date(item.isoDate) : new Date(),
                author: item.creator || item.author || null,
                // Use the full content if the snippet is empty
                summary: item.contentSnippet || item.content || (item as any).contentEncoded || null,
                image_url: image
            };
        }).filter(i => i.url !== '');
    } catch (e) {
        console.error(`RSS Fail [${url}]:`, e);
        return null;
    }
}