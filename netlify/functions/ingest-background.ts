import { schedule } from '@netlify/functions';
import { supabase } from '../../src/supabase';
import { fetchFeed } from '../../src/rss';

const handler = schedule('*/10 * * * *', async (event) => {
    console.log("⚡️ Ingest started...");
    
    // 1. Get Active Feeds (Order by last_fetched_at to rotate priority)
    const { data: feeds } = await supabase
        .from('feeds')
        .select('id, url')
        .eq('is_active', true)
        .order('last_fetched_at', { ascending: true });
        
    if (!feeds?.length) return { statusCode: 200 };

    // 2. Fetch & Update DB - SEQUENTIAL WRAPPER
    // We loop through instead of using Promise.all to respect Netlify's execution limits
    for (const feed of feeds) {
        try {
            console.log(`Processing: ${feed.url}`);
            const items = await fetchFeed(feed.url);
            
            if (items && items.length > 0) {
                const rows = items.map(i => ({
                    feed_id: feed.id,
                    title: i.title,
                    url: i.url,
                    published_at: i.published_at.toISOString(),
                    author: i.author,
                    // Clean HTML summary
                    summary: i.summary?.replace(/<[^>]*>?/gm, '').substring(0, 200),
                    image_url: i.image_url
                }));

                // Upsert to DB
                await supabase.from('items').upsert(rows, { 
                    onConflict: 'url', 
                    ignoreDuplicates: true 
                });
            }

            // Update timestamp even if fetch fails to keep rotation moving
            await supabase.from('feeds')
                .update({ last_fetched_at: new Date().toISOString() })
                .eq('id', feed.id);

        } catch (err) {
            console.error(`Failed to ingest ${feed.url}:`, err);
        }
    }

    // 3. AUTO-CLEANUP
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    
    await supabase
        .from('items')
        .delete()
        .lt('published_at', threeDaysAgo.toISOString());

    console.log("✅ Ingest and Cleanup complete.");
    return { statusCode: 200 };
});

export { handler };