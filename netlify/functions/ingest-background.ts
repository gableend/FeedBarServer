import { schedule } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import Parser from 'rss-parser';

// Initialize the robust parser
const parser = new Parser({
    timeout: 5000, // 5 second timeout
    headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8'
    }
});

// Helper to standardise fetching
const fetchFeed = async (url: string) => {
    try {
        const feed = await parser.parseURL(url);
        return feed.items || [];
    } catch (e: any) {
        // Log specifically to help debug future blocks
        // We trim the error to avoid massive log dumps
        const msg = e.message || String(e);
        console.warn(`Skipping ${url}: ${msg.substring(0, 100)}`);
        return [];
    }
};

const supabase = createClient(
    process.env.SUPABASE_URL || '', 
    process.env.SUPABASE_KEY || ''
);

export const handler = schedule('*/10 * * * *', async (event) => {
    console.log("⚡️ Batch Ingest started (rss-parser)...");
    
    // 1. SMART BATCHING
    // Grab 10 feeds sorted by oldest fetch time
    const { data: feeds } = await supabase
        .from('feeds')
        .select('id, url')
        .eq('is_active', true)
        .order('last_fetched_at', { ascending: true, nullsFirst: true }) 
        .limit(10); 
        
    if (!feeds?.length) return { statusCode: 200 };

    console.log(`Processing Batch of ${feeds.length} feeds...`);

    // 2. PARALLEL EXECUTION
    await Promise.all(feeds.map(async (feed) => {
        try {
            const items = await fetchFeed(feed.url);
            
            if (items && items.length > 0) {
                // Map to DB structure
                const rows = items.map((i: any) => ({
                    feed_id: feed.id,
                    title: i.title || 'Untitled',
                    url: i.link || i.enclosure?.url || i.guid, // Robust URL finding
                    published_at: i.isoDate ? new Date(i.isoDate).toISOString() : 
                                  (i.pubDate ? new Date(i.pubDate).toISOString() : new Date().toISOString()),
                    // Clean summary (strip HTML tags)
                    summary: (i.contentSnippet || i.content || i.summary || '').substring(0, 300),
                    image_url: i.enclosure?.url || i.itunes?.image || null
                }));

                // Filter out invalid rows (missing URL or title)
                const validRows = rows.filter((r: any) => r.url && r.title);

                if (validRows.length > 0) {
                    const { error } = await supabase
                        .from('items')
                        .upsert(validRows, { onConflict: 'url', ignoreDuplicates: true });
                    
                    if (error) console.error(`DB Error ${feed.url}:`, error.message);
                }
            }

            // 3. MARK AS DONE (Touch timestamp)
            await supabase.from('feeds')
                .update({ last_fetched_at: new Date().toISOString() })
                .eq('id', feed.id);

        } catch (err) {
            console.error(`Failed ${feed.url}:`, err);
        }
    }));

    // 4. FAST CLEANUP (Keep DB lean)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    await supabase
        .from('items')
        .delete()
        .lt('published_at', sevenDaysAgo.toISOString());

    console.log("✅ Batch complete.");
    return { statusCode: 200 };
});