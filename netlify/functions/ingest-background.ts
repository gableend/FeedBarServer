import { schedule } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { parse } from 'rss-to-json';

// Helper to standardise fetching (RSS-to-JSON wrapper)
const fetchFeed = async (url: string) => {
    try {
        // 5s timeout to prevent one slow feed from hanging the batch
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        
        const rss = await parse(url, { signal: controller.signal });
        clearTimeout(timeout);
        return rss ? rss.items : [];
    } catch (e: any) { // ✅ FIX: Added ': any' to resolve TS18046
        console.warn(`Skipping ${url}:`, e?.message || String(e));
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
                // Map to DB structure
                const rows = items.map((i: any) => ({
                    feed_id: feed.id,
                    title: i.title || 'Untitled',
                    url: i.link || i.url,
                    published_at: i.published ? new Date(i.published).toISOString() : new Date().toISOString(),
                    // Clean summary (strip HTML tags)
                    summary: (i.description || i.content || '').replace(/<[^>]*>?/gm, '').substring(0, 300),
                    image_url: i.enclosures?.[0]?.url || i.media?.thumbnail?.url || null
                }));

                // Upsert Items
                const { error } = await supabase
                    .from('items')
                    .upsert(rows, { onConflict: 'url', ignoreDuplicates: true });
                
                if (error) console.error(`DB Error ${feed.url}:`, error.message);
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