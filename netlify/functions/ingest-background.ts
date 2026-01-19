import { schedule } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { parse } from 'rss-to-json';

// Helper to standardise fetching (RSS-to-JSON wrapper) with User-Agent spoofing
const fetchFeed = async (url: string) => {
    try {
        // 5s timeout to prevent one slow feed from hanging the batch
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        
        // ✅ FIX: Send headers to bypass 403/404 blocks from Bloomberg, etc.
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8'
        };

        // Note: rss-to-json allows passing fetch options as the second argument
        const rss = await parse(url, { 
            signal: controller.signal,
            headers: headers
        });
        
        clearTimeout(timeout);
        return rss ? rss.items : [];
    } catch (e: any) {
        // Log specifically to help debug future blocks
        const msg = e?.message || String(e);
        console.warn(`Skipping ${url}: ${msg}`);
        return [];
    }
};

const supabase = createClient(
    process.env.SUPABASE_URL || '', 
    process.env.SUPABASE_KEY || ''
);

export const handler = schedule('*/10 * * * *', async (event) => {
    console.log("⚡️ Batch Ingest started...");
    
    // 1. SMART BATCHING
    // Only grab the 10 "hungriest" feeds (oldest fetch time)
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
                const rows = items.map((i: any) => ({
                    feed_id: feed.id,
                    title: i.title || 'Untitled',
                    url: i.link || i.url,
                    published_at: i.published ? new Date(i.published).toISOString() : new Date().toISOString(),
                    // Clean summary (strip HTML tags)
                    summary: (i.description || i.content || '').replace(/<[^>]*>?/gm, '').substring(0, 300),
                    image_url: i.enclosures?.[0]?.url || i.media?.thumbnail?.url || null
                }));

                const { error } = await supabase
                    .from('items')
                    .upsert(rows, { onConflict: 'url', ignoreDuplicates: true });
                
                if (error) console.error(`DB Error ${feed.url}:`, error.message);
            }

            // 3. MARK AS DONE
            await supabase.from('feeds')
                .update({ last_fetched_at: new Date().toISOString() })
                .eq('id', feed.id);

        } catch (err) {
            console.error(`Failed ${feed.url}:`, err);
        }
    }));

    // 4. FAST CLEANUP
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    await supabase
        .from('items')
        .delete()
        .lt('published_at', sevenDaysAgo.toISOString());

    console.log("✅ Batch complete.");
    return { statusCode: 200 };
});